"""Lean V3 runtime quality layer for /search: format, identity, dish-family rules.

Pure Python over the top-200 candidate rows (no Snowflake), same pattern as
provenance/recommendation.py — every rule is unit-testable and tunable offline
against a dumped candidate list.

Design rule (fail open): a requirement exists ONLY when the query explicitly
names it. No query term, no filtering — vector ranking stands as-is.
"""
import re

# ---------------------------------------------------------------------------
# Intent: narrow TRIGGERS (what in the query creates a requirement) vs broad
# ALIASES (what lets a candidate satisfy it). Asymmetric on purpose: precision
# on intent, recall on candidates.
TRIGGERS = {
    "soup":    ["soup"],
    "stew":    ["stew", "jjigae"],
    "noodle":  ["noodle", "noodles", "ramen", "udon", "soba", "pasta"],
    "dessert": ["dessert"],
    "salad":   ["salad"],
    "curry":   ["curry"],
}
ALIASES = {
    "soup":    ["soup", "broth", "bisque", "chowder", "consomme", "pho", "ramen",
                "stew", "jjigae", "gumbo", "minestrone"],
    "stew":    ["stew", "jjigae", "chili", "goulash", "gumbo", "tagine", "curry",
                "cassoulet"],
    "noodle":  ["noodle", "ramen", "udon", "soba", "pasta", "spaghetti", "linguine",
                "fettuccine", "macaroni", "penne", "lasagna", "lo mein", "chow mein",
                "pad thai", "vermicelli", "zoodle", "pho", "orzo", "gnocchi"],
    "dessert": ["dessert", "cake", "pudding", "pie", "cookie", "brownie", "ice cream",
                "sherbet", "sorbet", "custard", "mousse", "tart", "cobbler", "fudge",
                "cheesecake", "crumble", "trifle", "baklava", "macaroon", "truffle"],
    "salad":   ["salad", "slaw"],
    "curry":   ["curry", "korma", "masala", "vindaloo", "tikka"],
}

# Drink: treated as one more identity group instead of a UI toggle. Default is
# food-only; the query itself grants drink access ("smoothie", "iced tea", ...).
DRINK_QUERY_WORDS = ["drink", "drinks", "beverage", "cocktail", "smoothie", "juice",
                     "limeade", "lemonade", "punch", "milkshake", "shake", "latte",
                     "tea", "coffee", "cider", "soda", "cocoa", "mocktail", "boba"]
# Candidate side keys off the dish HEAD, not any mention: "Green Tea Ice Cream"
# is food, "Russian Tea" is a drink.
DRINK_TITLE_HEADS = {"limeade", "lemonade", "punch", "daiquiri", "margarita",
                     "mojito", "sangria", "smoothie", "juice", "cocktail",
                     "milkshake", "shake", "latte", "cappuccino", "espresso",
                     "frappe", "cocoa", "cider", "soda", "tea", "coffee", "eggnog",
                     "nog", "slush", "cooler", "spritzer", "julep", "toddy",
                     "wassail", "drink", "beverage", "lassi", "horchata",
                     "fizz", "fizzy"}
DRINK_TITLE_PHRASES = {"hot chocolate", "iced tea", "iced coffee", "hot cocoa"}

# Mirrors the SQL COMPONENT_RE words in ui/server.py, plus the V3 additions
# (ganache/frosting/icing/filling/topping — added to the SQL regex too). Used
# only for the query-side exemption: "chocolate ganache" may keep ganache.
COMPONENT_WORDS = {"paste", "marinade", "rub", "seasoning", "wrapper", "wrappers",
                   "batter", "sauce", "dressing", "glaze", "stock", "broth",
                   "ketchup", "mustard", "mayonnaise", "mayo", "relish", "syrup",
                   "jam", "jelly", "chutney", "pesto", "vinaigrette", "dip",
                   "ganache", "frosting", "icing", "filling", "topping"}

_STOP = {"a", "an", "the", "best", "easy", "quick", "simple", "classic", "homemade",
         "favorite", "favourite", "perfect", "ultimate", "delicious", "my", "mom",
         "moms", "grandma", "grandmas", "style", "recipe", "ii", "iii", "iv",
         "and", "with", "in", "of", "for", "on", "or", "amp"}


def _word_re(words):
    # s? absorbs simple plurals: cookie/cookies, noodle/noodles
    return re.compile(r"\b(?:" + "|".join(re.escape(w) for w in words) + r")s?\b")


_TRIGGER_RE = {g: _word_re(ws) for g, ws in TRIGGERS.items()}
_ALIAS_RE = {g: _word_re(ws) for g, ws in ALIASES.items()}
_DRINK_QUERY_RE = _word_re(DRINK_QUERY_WORDS)
_COMPONENT_RE = _word_re(COMPONENT_WORDS)


def infer_intent(query):
    """Explicit, high-confidence requirements from the raw query text only."""
    q = query.lower()
    return {
        "required_identity": [g for g in TRIGGERS if _TRIGGER_RE[g].search(q)],
        "drink_ok": bool(_DRINK_QUERY_RE.search(q)),
        "requested_components": set(_COMPONENT_RE.findall(q)),
    }


def _strip_parens(title):
    """'Kimchi Jjigae (Korean Kimchi Stew)' -> 'Kimchi Jjigae'. Parentheticals are
    translations/annotations, not identity; keep them only if nothing else remains."""
    bare = re.sub(r"\([^)]*\)", " ", title)
    return bare if bare.strip() else title


def normalize_title(title):
    """Lowercase, & -> and, drop parentheticals, punctuation, filler. Returns tokens."""
    t = _strip_parens(title).lower().replace("&", " and ")
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    return [w for w in t.split() if w not in _STOP]


_CLAUSE_WORDS = {"with", "in", "over"}


def _head(title):
    """Dish head = last meaningful token before any 'with/in/over' clause.
    'Hot And Sour Soup with Chicken' -> soup."""
    words = _strip_parens(title).lower().split()
    cut = next((i for i, w in enumerate(words) if w in _CLAUSE_WORDS and 0 < i < len(words) - 1), len(words))
    toks = normalize_title(" ".join(words[:cut]))
    return toks[-1] if toks else ""


def same_dish_family(a, b):
    """Query-aware clustering: identical normalized titles, or same head plus
    high token overlap. ponytail: token-set heuristic, upgrade to learned
    similarity only if the regression set shows real misses."""
    ta, tb = set(normalize_title(a)), set(normalize_title(b))
    if not ta or not tb:
        return False
    if ta == tb:
        return True
    if _head(a) != _head(b):
        return False
    inter = len(ta & tb)
    return inter / min(len(ta), len(tb)) >= 0.8 and inter / len(ta | tb) >= 0.6


def is_drink(title):
    toks = normalize_title(title)
    if not toks:
        return False
    return (re.sub(r"s$", "", toks[-1]) in DRINK_TITLE_HEADS
            or " ".join(toks[-2:]) in DRINK_TITLE_PHRASES)


def component_allowed(title, intent):
    """A component survives only when the query names that same component."""
    req = intent["requested_components"]
    return bool(req) and bool(req & set(normalize_title(title)))


def _satisfies(group, title, profile):
    # Title first — that's where identity lives; enrichment prose is fallback.
    return bool(_ALIAS_RE[group].search(title.lower())
                or _ALIAS_RE[group].search((profile or "").lower()))


def rejection(title, profile, intent, kept):
    """Why this candidate must not be served, or None. kept = accepted
    [(recipe_id, title)] so duplicates cite the survivor."""
    if not intent["drink_ok"] and is_drink(title):
        return "format_mismatch:drink"
    for group in intent["required_identity"]:
        if not _satisfies(group, title, profile):
            return f"identity_mismatch:{group}"
    for rid, kt in kept:
        if same_dish_family(title, kt):
            return f"duplicate_dish:{rid}"
    return None
