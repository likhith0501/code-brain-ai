# Developer Assistant with Project Memory

An evidence-first developer assistant that stores project decisions, components, dependencies, bugs, and fixes in Neo4j and retrieves connected history for debugging questions.

## Quick start

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload
```

The API is available at `http://localhost:8000`, with OpenAPI documentation at `/docs`.
Without database credentials the API runs in clearly labeled in-memory development mode. Set `POSTGRES_URL` to persist relational graph records and events across backend restarts, and set `NEO4J_URI`, `NEO4J_USERNAME`, and `NEO4J_PASSWORD` to synchronize the same records into Neo4j.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

The Vite app is available at `http://localhost:5173`.

## Deploy frontend to Vercel and backend to Render

Push this repository to GitHub, then create two services from the same repository.

### Render backend

1. In Render, choose **New > Blueprint** and select the repository. Render will use [`render.yaml`](./render.yaml).
2. Create a Render PostgreSQL database, then set `POSTGRES_URL` to its internal connection URL.
3. Set `NEO4J_URI`, `NEO4J_USERNAME`, and `NEO4J_PASSWORD` for Neo4j Aura or another reachable Neo4j instance.
4. Set `GEMINI_API_KEY` only in Render's backend environment variables. Never commit it.
5. After deployment, verify `https://<render-service>.onrender.com/api/health`.

### Vercel frontend

1. Import the same repository into Vercel.
2. Set the project root directory to `frontend`.
3. Use the default Vite settings:
   - Build command: `npm run build`
   - Output directory: `dist`
4. Add the environment variable `VITE_API_BASE_URL` with the value `https://<render-service>.onrender.com/api`.
5. Redeploy after setting the variable.
6. Copy the Vercel URL into Render's `FRONTEND_ORIGIN` environment variable and redeploy the backend.

`VITE_API_BASE_URL` is public frontend configuration and must contain only the API URL. API keys and database credentials belong only in Render backend environment variables.

### Neo4j

```powershell
docker compose up -d postgres neo4j
cd backend
python ..\scripts\initialize_database.py
python ..\scripts\seed_demo.py
```

The seed is idempotent and creates the authentication demo described in the product requirements. It never deletes existing data.

## Architecture

`backend/app/main.py` exposes validated project and memory CRUD, graph traversal, search, timeline, dashboard statistics, health, and assistant endpoints. When `POSTGRES_URL` is configured, nodes, relationships, and project events are loaded from and written to PostgreSQL using conflict-safe upserts. When Neo4j credentials are configured, the same store also loads and mirrors graph entities and relationships with parameterized Cypher. If neither database is available, it explicitly uses in-memory development mode. The assistant prepares deduplicated evidence and uses a labeled rule-based response until a provider adapter is configured. The frontend consumes API responses and does not contain project history.

The core graph uses `Project`, `Component`, `Dependency`, `Decision`, `Reason`, `Bug`, `Fix`, and `CodeReference` nodes. Relationships are persisted with provenance and timestamps. All retrieval starts from the requested project ID.

Additional API surfaces include:

- `GET /api/projects/{project_id}/dashboard/stats`
- `GET /api/projects/{project_id}/dashboard/activity`
- `GET /api/projects/{project_id}/search?q=...`
- `GET /api/projects/{project_id}/timeline`
- `GET /api/projects/{project_id}/graph/neighbors/{node_id}?depth=1`
- `GET/POST /api/bugs/{bug_id}/fixes`
- `PATCH` and `DELETE` routes for projects and core memory entities

## Security notes

Credentials remain backend-only environment variables. Inputs are size-limited and validated with Pydantic. Cypher is parameterized, traversal depth is bounded, and imported text is treated as untrusted data. The fallback mode is intended for a single-user local demo; add authentication and per-user authorization before exposing the service publicly.

## Tests

```powershell
cd backend
pytest
```
