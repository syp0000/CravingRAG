# CravingRAG demo — one image serves the React build AND the live Snowflake API
# (ui/server.py). Deploy target: Render / Railway / Fly, put Cloudflare Access in front.
#
# Snowflake credentials come from env (see requirements-deploy note): set
#   SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PRIVATE_KEY (inline PEM),
#   optional SNOWFLAKE_WAREHOUSE / DATABASE / ROLE / PRIVATE_KEY_PWD.

# --- stage 1: build the frontend ---
FROM node:20-slim AS web
WORKDIR /app/ui/app
COPY ui/app/package.json ui/app/package-lock.json ./
RUN npm ci
COPY ui/app/ ./
RUN npm run build

# --- stage 2: python runtime ---
FROM python:3.12-slim
WORKDIR /app
COPY requirements/deploy.txt ./requirements/deploy.txt
RUN pip install --no-cache-dir -r requirements/deploy.txt
COPY ui/ ./ui/
COPY provenance/ ./provenance/
COPY docs/diagrams/ ./docs/diagrams/
COPY --from=web /app/ui/app/dist ./ui/app/dist
ENV HOST=0.0.0.0 PORT=8642
# CRAVING_DECISIONS defaults to jsonl so /why trace links work within the running
# instance (data/ is ephemeral — records reset on redeploy, fine for a demo).
EXPOSE 8642
CMD ["python", "ui/server.py"]
