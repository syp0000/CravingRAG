"""Run from repo root:  ./.venv/bin/pytest ui/ -v"""
from ui.search_quality import (component_allowed, infer_intent, is_drink,
                               rejection, same_dish_family)


def test_intent_from_explicit_terms_only():
    i = infer_intent("a savory noodle soup")
    assert sorted(i["required_identity"]) == ["noodle", "soup"]
    assert not i["drink_ok"]
    # vague queries create no requirements — fail open
    assert infer_intent("something rich and comforting")["required_identity"] == []


def test_query_grants_drink_and_component_access():
    assert infer_intent("a refreshing berry smoothie")["drink_ok"]
    assert "ganache" in infer_intent("chocolate ganache")["requested_components"]


def test_drink_classification_keys_off_dish_head():
    # "Fizzy": live-corpus find — a rum-prosecco cocktail whose only drink signal is the head
    for t in ["Thirst-Quenching Limeade", "Daiquiri Punch", "Hot Chocolate", "Russian Tea",
              "Fizzy", "Sloe Gin Fizz"]:
        assert is_drink(t), t
    for t in ["Hot Chocolate Cake", "Green Tea Ice Cream", "Coffee Cake", "Beef Stew"]:
        assert not is_drink(t), t


def test_hot_and_sour_variants_are_one_family():
    a = "Hot And Sour Soup"
    assert same_dish_family(a, "Hot & Sour Soup")
    assert same_dish_family(a, "Hot and Sour Soup with Chicken")
    assert same_dish_family(a, "Hot And Sour Chicken Soup")


def test_distinct_dishes_stay_distinct():
    assert not same_dish_family("Beef Soup", "Chicken Soup")
    assert not same_dish_family("Thai Chicken Curry", "Indian Chicken Curry")
    assert not same_dish_family("Chicken Salad", "Chicken Soup")          # head differs
    # documented intent: for a generic query these ARE one family (diversity wins)
    assert same_dish_family("Chicken Soup", "Chicken Noodle Soup")
    assert same_dish_family("Kimchi Jjigae", "Kimchi Jjigae II")


def test_parentheticals_do_not_split_families():
    # live-corpus regression: three jjigae variants occupied three result slots
    assert same_dish_family("Kimchi Jjigae (Korean Kimchi Soup)",
                            "Gochujang Kimchi Jjigae (Kimchi Stew)")
    assert same_dish_family("Kimchi Jjigae (Korean Kimchi Stew)",
                            "Kimchi Jjigae (Korean Kimchi Soup)")
    # different jjigae stays: budae is not kimchi jjigae
    assert not same_dish_family("Korean Budae Jjigae 부대찌개 (Army Stew)",
                                "Kimchi Jjigae (Korean Kimchi Stew)")


def test_rejection_pipeline():
    intent = infer_intent("a savory noodle soup")
    assert rejection("Italian Soup", "hearty tomato broth", intent, []) == "identity_mismatch:noodle"
    assert rejection("Miso Ramen", "", intent, []) is None
    assert rejection("Thirst-Quenching Limeade", "", intent, []) == "format_mismatch:drink"
    kept = [(42, "Chicken Noodle Soup")]
    assert rejection("Chicken Noodle Soup II", "", intent, kept) == "duplicate_dish:42"
    # profile text can satisfy identity when the title doesn't
    assert rejection("Pho Bo", "rice noodle beef broth", infer_intent("noodle soup"), []) is None


def test_component_exemption_is_query_scoped():
    assert component_allowed("Dark Chocolate Ganache", infer_intent("chocolate ganache"))
    assert not component_allowed("Dark Chocolate Ganache", infer_intent("chocolate dessert"))
    assert not component_allowed("BBQ Sauce", infer_intent("chocolate ganache"))


if __name__ == "__main__":  # assert-based self-check without pytest
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ok")
