from __future__ import annotations

import re
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

try:
    from neo4j import GraphDatabase
except ImportError:
    GraphDatabase = None
try:
    import psycopg
except ImportError:
    psycopg = None

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    neo4j_uri: str = ""
    neo4j_username: str = ""
    neo4j_password: str = ""
    postgres_url: str = ""
    ai_provider: str = "gemini"
    gemini_api_key: str = ""
    ai_model: str = "gemini-2.0-flash"
    frontend_origin: str = "http://localhost:5173"


settings = Settings()
logger = logging.getLogger("devmind")
app = FastAPI(title="Developer Assistant with Project Memory", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list({settings.frontend_origin, "http://localhost:5173", "http://127.0.0.1:5173"}),
    allow_methods=["*"],
    allow_headers=["*"],
)


class ProjectIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=5000)
    repository_url: str | None = Field(default=None, max_length=500)


class ProjectPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=5000)
    repository_url: str | None = Field(default=None, max_length=500)


class MemoryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=10000)
    component_id: str | None = None
    reason: str = Field(default="", max_length=5000)
    error_message: str = Field(default="", max_length=5000)
    severity: str = Field(default="medium", max_length=30)
    version: str = Field(default="", max_length=100)
    package_manager: str = Field(default="", max_length=50)


class QuestionIn(BaseModel):
    question: str = Field(min_length=3, max_length=4000)
    component_id: str | None = None


class MemoryStore:
    def __init__(self) -> None:
        self.nodes: dict[str, dict[str, Any]] = {}
        self.edges: list[dict[str, Any]] = []
        self.events: list[dict[str, Any]] = []
        self.driver = None
        self.postgres = None
        if psycopg and settings.postgres_url:
            try:
                self.postgres = psycopg.connect(settings.postgres_url, autocommit=True)
                self._initialize_postgres()
                self._load_from_postgres()
            except Exception as exc:
                logger.warning("PostgreSQL unavailable; continuing without durable relational storage: %s", type(exc).__name__)
                if self.postgres:
                    self.postgres.close()
                self.postgres = None
        if GraphDatabase and settings.neo4j_uri and settings.neo4j_username and settings.neo4j_password:
            try:
                self.driver = GraphDatabase.driver(settings.neo4j_uri, auth=(settings.neo4j_username, settings.neo4j_password))
                self.driver.verify_connectivity()
                self._load_from_neo4j()
            except Exception as exc:
                logger.warning("Neo4j unavailable; using in-memory mode: %s", type(exc).__name__)
                if self.driver:
                    self.driver.close()
                self.driver = None

    def _initialize_postgres(self) -> None:
        if not self.postgres:
            return
        with self.postgres.cursor() as cursor:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS graph_nodes (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    data JSONB NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS graph_edges (
                    source TEXT NOT NULL,
                    target TEXT NOT NULL,
                    type TEXT NOT NULL,
                    data JSONB NOT NULL,
                    PRIMARY KEY (source, target, type)
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS project_events (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    data JSONB NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS graph_nodes_project_idx ON graph_nodes(project_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS project_events_project_idx ON project_events(project_id)")

    def _load_from_postgres(self) -> None:
        if not self.postgres:
            return
        with self.postgres.cursor() as cursor:
            cursor.execute("SELECT data FROM graph_nodes")
            for (data,) in cursor.fetchall():
                self.nodes[data["id"]] = dict(data)
            cursor.execute("SELECT source, target, type, data FROM graph_edges")
            for source, target, edge_type, data in cursor.fetchall():
                self.edges.append({"source": source, "target": target, "type": edge_type, **dict(data)})
            cursor.execute("SELECT data FROM project_events")
            self.events.extend(dict(data) for (data,) in cursor.fetchall())

    def _load_from_neo4j(self) -> None:
        with self.driver.session() as session:
            for record in session.run("MATCH (n:Entity) RETURN labels(n) AS labels, properties(n) AS props"):
                props = dict(record["props"])
                labels = [label for label in record["labels"] if label != "Entity"]
                if labels:
                    props["type"] = labels[0]
                    self.nodes[props["id"]] = props
            for record in session.run("MATCH (a:Entity)-[r]->(b:Entity) RETURN a.id AS source, type(r) AS type, b.id AS target, properties(r) AS props"):
                self.edges.append({"source": record["source"], "target": record["target"], "type": record["type"], **dict(record["props"])})

    def _persist_node(self, item: dict[str, Any]) -> None:
        if self.postgres:
            with self.postgres.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO graph_nodes (id, project_id, type, data) VALUES (%s, %s, %s, %s) "
                    "ON CONFLICT (id) DO UPDATE SET project_id = EXCLUDED.project_id, type = EXCLUDED.type, data = EXCLUDED.data, updated_at = NOW()",
                    (item["id"], item.get("project_id", ""), item["type"], psycopg.types.json.Jsonb(item)),
                )
        if not self.driver:
            return
        label = item["type"] if item["type"] in {"Project", "Component", "Dependency", "Decision", "Reason", "Bug", "Fix", "CodeReference", "TechnicalNote"} else "Entity"
        props = {key: value for key, value in item.items() if key != "type"}
        with self.driver.session() as session:
            session.run("MERGE (n:Entity {id: $id}) SET n += $props SET n:`" + label + "`", id=item["id"], props=props).consume()

    def _persist_edge(self, edge: dict[str, Any]) -> None:
        if self.postgres:
            edge_data = {key: value for key, value in edge.items() if key not in {"source", "target", "type"}}
            with self.postgres.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO graph_edges (source, target, type, data) VALUES (%s, %s, %s, %s) "
                    "ON CONFLICT (source, target, type) DO UPDATE SET data = EXCLUDED.data",
                    (edge["source"], edge["target"], edge["type"], psycopg.types.json.Jsonb(edge_data)),
                )
        if not self.driver:
            return
        relationship = edge["type"] if edge["type"].isidentifier() else "RELATED_TO"
        props = {key: value for key, value in edge.items() if key not in {"source", "target", "type"}}
        with self.driver.session() as session:
            session.run("MATCH (a:Entity {id: $source}), (b:Entity {id: $target}) MERGE (a)-[r:" + relationship + "]->(b) SET r += $props", source=edge["source"], target=edge["target"], props=props).consume()

    def add(self, label: str, project_id: str, props: dict[str, Any]) -> dict[str, Any]:
        item = {"id": str(uuid4()), "type": label, "project_id": project_id, **props, "created_at": now()}
        self.nodes[item["id"]] = item
        self._persist_node(item)
        if project_id:
            event = {"id": str(uuid4()), "project_id": project_id, "type": f"{label.lower()}_created", "entity_id": item["id"], "title": item.get("title", item.get("name", label)), "created_at": item["created_at"]}
            self.events.append(event)
            self._persist_event(event)
        return item

    def _persist_event(self, event: dict[str, Any]) -> None:
        if not self.postgres:
            return
        with self.postgres.cursor() as cursor:
            cursor.execute(
                "INSERT INTO project_events (id, project_id, data, created_at) VALUES (%s, %s, %s, NOW()) ON CONFLICT (id) DO NOTHING",
                (event["id"], event["project_id"], psycopg.types.json.Jsonb(event)),
            )

    def project_nodes(self, project_id: str, types: set[str] | None = None) -> list[dict[str, Any]]:
        return [n for n in self.nodes.values() if n["project_id"] == project_id and (not types or n["type"] in types)]

    def link(self, source: str, target: str, kind: str) -> None:
        if not any(e["source"] == source and e["target"] == target and e["type"] == kind for e in self.edges):
            edge = {"source": source, "target": target, "type": kind, "created_at": now()}
            self.edges.append(edge)
            self._persist_edge(edge)

    def remove(self, node_id: str) -> None:
        if self.postgres:
            with self.postgres.cursor() as cursor:
                cursor.execute("DELETE FROM graph_nodes WHERE id = %s", (node_id,))
                cursor.execute("DELETE FROM graph_edges WHERE source = %s OR target = %s", (node_id, node_id))
                cursor.execute("DELETE FROM project_events WHERE data->>'entity_id' = %s", (node_id,))
        if self.driver:
            with self.driver.session() as session:
                session.run("MATCH (n:Entity {id: $id}) DETACH DELETE n", id=node_id).consume()
        self.nodes.pop(node_id, None)
        self.edges = [edge for edge in self.edges if edge["source"] != node_id and edge["target"] != node_id]
        self.events = [event for event in self.events if event["entity_id"] != node_id]


store = MemoryStore()


def get_project(project_id: str) -> dict[str, Any]:
    project = store.nodes.get(project_id)
    if not project or project["type"] != "Project":
        raise HTTPException(404, "Project not found")
    return project


@app.get("/api/health")
def health() -> dict[str, Any]:
    configured = bool(settings.neo4j_uri and settings.neo4j_username and settings.neo4j_password)
    connected = bool(store.driver)
    return {"status": "ok", "database": "connected" if connected else ("configured but unavailable" if configured else "in-memory development mode"), "ai_provider": settings.ai_provider, "ai_available": bool(settings.gemini_api_key)}


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "DevMind AI API", "status": "ok"}


@app.get("/api/projects")
def list_projects() -> list[dict[str, Any]]:
    projects = store.project_nodes("", {"Project"}) if False else [n for n in store.nodes.values() if n["type"] == "Project"]
    result = []
    for p in projects:
        counts = {t.lower(): len(store.project_nodes(p["id"], {t})) for t in ["Component", "Decision", "Bug", "Dependency", "Fix"]}
        result.append({**p, "counts": counts})
    return result


@app.post("/api/projects", status_code=201)
def create_project(payload: ProjectIn) -> dict[str, Any]:
    item = store.add("Project", "", payload.model_dump())
    event = {"id": str(uuid4()), "project_id": item["id"], "type": "project_created", "entity_id": item["id"], "title": item["name"], "created_at": item["created_at"]}
    store.events.append(event)
    store._persist_event(event)
    return item


@app.get("/api/projects/{project_id}")
def read_project(project_id: str) -> dict[str, Any]:
    return get_project(project_id)


@app.patch("/api/projects/{project_id}")
def update_project(project_id: str, payload: ProjectPatch) -> dict[str, Any]:
    project = get_project(project_id)
    changes = payload.model_dump(exclude_unset=True)
    project.update(changes)
    project["updated_at"] = now()
    store._persist_node(project)
    event = {"id": str(uuid4()), "project_id": project_id, "type": "project_updated", "entity_id": project_id, "title": project["name"], "created_at": project["updated_at"]}
    store.events.append(event)
    store._persist_event(event)
    return project


@app.delete("/api/projects/{project_id}", status_code=204)
def delete_project(project_id: str) -> None:
    get_project(project_id)
    for node in list(store.nodes.values()):
        if node["id"] == project_id or node.get("project_id") == project_id:
            store.remove(node["id"])


def create_memory(project_id: str, kind: str, payload: MemoryIn) -> dict[str, Any]:
    get_project(project_id)
    data = payload.model_dump()
    component_id = data.pop("component_id", None)
    item = store.add(kind, project_id, data)
    if component_id:
        component = store.nodes.get(component_id)
        if not component or component["project_id"] != project_id:
            raise HTTPException(400, "Component is not in the selected project")
        store.link(component_id, item["id"], {"Decision": "HAS_DECISION", "Bug": "AFFECTED_BY", "Dependency": "DEPENDS_ON"}.get(kind, "RELATED_TO"))
    return item


@app.get("/api/projects/{project_id}/memories")
def memories(project_id: str, type: str | None = Query(default=None)) -> dict[str, Any]:
    get_project(project_id)
    nodes = store.project_nodes(project_id, {type.title()} if type else None)
    edges = [e for e in store.edges if e["source"] in {n["id"] for n in nodes} or e["target"] in {n["id"] for n in nodes}]
    return {"nodes": nodes, "edges": edges}


@app.post("/api/projects/{project_id}/components", status_code=201)
def create_component(project_id: str, payload: MemoryIn) -> dict[str, Any]:
    item = create_memory(project_id, "Component", payload)
    store.link(project_id, item["id"], "HAS_COMPONENT")
    return item


@app.post("/api/projects/{project_id}/decisions", status_code=201)
def create_decision(project_id: str, payload: MemoryIn) -> dict[str, Any]:
    item = create_memory(project_id, "Decision", payload)
    if item.get("reason"):
        reason = store.add("Reason", project_id, {"description": item["reason"], "evidence": "developer-provided"})
        store.link(item["id"], reason["id"], "BASED_ON")
    return item


@app.post("/api/projects/{project_id}/bugs", status_code=201)
def create_bug(project_id: str, payload: MemoryIn) -> dict[str, Any]:
    return create_memory(project_id, "Bug", payload)


@app.post("/api/projects/{project_id}/dependencies", status_code=201)
def create_dependency(project_id: str, payload: MemoryIn) -> dict[str, Any]:
    return create_memory(project_id, "Dependency", payload)


def list_memory(project_id: str, kind: str) -> list[dict[str, Any]]:
    get_project(project_id)
    return store.project_nodes(project_id, {kind})


@app.get("/api/projects/{project_id}/components")
def list_components(project_id: str) -> list[dict[str, Any]]:
    return list_memory(project_id, "Component")


@app.get("/api/projects/{project_id}/decisions")
def list_decisions(project_id: str) -> list[dict[str, Any]]:
    return list_memory(project_id, "Decision")


@app.get("/api/projects/{project_id}/dependencies")
def list_dependencies(project_id: str) -> list[dict[str, Any]]:
    return list_memory(project_id, "Dependency")


@app.get("/api/projects/{project_id}/bugs")
def list_bugs(project_id: str) -> list[dict[str, Any]]:
    return list_memory(project_id, "Bug")


@app.patch("/api/components/{node_id}")
@app.patch("/api/decisions/{node_id}")
@app.patch("/api/dependencies/{node_id}")
@app.patch("/api/bugs/{node_id}")
def update_memory(node_id: str, payload: MemoryIn) -> dict[str, Any]:
    item = store.nodes.get(node_id)
    if not item or item["type"] not in {"Component", "Decision", "Dependency", "Bug"}:
        raise HTTPException(404, "Memory record not found")
    item.update(payload.model_dump(exclude_unset=True))
    item["updated_at"] = now()
    store._persist_node(item)
    return item


@app.delete("/api/components/{node_id}", status_code=204)
@app.delete("/api/decisions/{node_id}", status_code=204)
@app.delete("/api/dependencies/{node_id}", status_code=204)
@app.delete("/api/bugs/{node_id}", status_code=204)
def delete_memory(node_id: str) -> None:
    if node_id not in store.nodes:
        raise HTTPException(404, "Memory record not found")
    store.remove(node_id)


@app.post("/api/bugs/{bug_id}/fixes", status_code=201)
def create_fix(bug_id: str, payload: MemoryIn) -> dict[str, Any]:
    bug = store.nodes.get(bug_id)
    if not bug or bug["type"] != "Bug":
        raise HTTPException(404, "Bug not found")
    fix = store.add("Fix", bug["project_id"], payload.model_dump())
    store.link(bug_id, fix["id"], "FIXED_BY")
    return fix


@app.get("/api/bugs/{bug_id}/fixes")
def list_fixes(bug_id: str) -> list[dict[str, Any]]:
    bug = store.nodes.get(bug_id)
    if not bug or bug["type"] != "Bug":
        raise HTTPException(404, "Bug not found")
    fix_ids = {edge["target"] for edge in store.edges if edge["source"] == bug_id and edge["type"] == "FIXED_BY"}
    return [store.nodes[node_id] for node_id in fix_ids if node_id in store.nodes]


@app.get("/api/projects/{project_id}/search")
def search(project_id: str, q: str = Query(min_length=1, max_length=200)) -> list[dict[str, Any]]:
    get_project(project_id)
    query = q.lower()
    return [node for node in store.project_nodes(project_id) if any(query in str(value).lower() for value in node.values() if isinstance(value, str))][:50]


@app.get("/api/search")
def global_search(q: str = Query(min_length=1, max_length=200)) -> list[dict[str, Any]]:
    query = q.lower()
    results = []
    for node in store.nodes.values():
        if any(query in str(value).lower() for value in node.values() if isinstance(value, str)):
            results.append(node)
    return results[:50]


@app.get("/api/projects/{project_id}/timeline")
def timeline(project_id: str) -> list[dict[str, Any]]:
    get_project(project_id)
    return sorted([event for event in store.events if event["project_id"] == project_id], key=lambda event: event["created_at"], reverse=True)


@app.get("/api/projects/{project_id}/dashboard/stats")
def dashboard_stats(project_id: str) -> dict[str, Any]:
    get_project(project_id)
    counts = {kind.lower(): len(list_memory(project_id, kind)) for kind in ["Component", "Dependency", "Decision", "Bug", "Fix", "TechnicalNote"]}
    counts["resolved_bugs"] = sum(1 for bug in list_memory(project_id, "Bug") if str(bug.get("status", "")).lower() in {"resolved", "closed"})
    return counts


@app.get("/api/projects/{project_id}/dashboard/activity")
def dashboard_activity(project_id: str) -> list[dict[str, Any]]:
    return timeline(project_id)

@app.post("/api/projects/{project_id}/assistant/ask")
def ask(project_id: str, payload: QuestionIn) -> dict[str, Any]:
    get_project(project_id)
    words = {w.lower() for w in re.findall(r"[A-Za-z0-9_.-]{3,}", payload.question)}
    candidates = [n for n in store.project_nodes(project_id) if n["type"] != "Project"]
    relevant = [n for n in candidates if any(str(v).lower() in words or any(word in str(v).lower() for word in words) for v in n.values() if isinstance(v, str))]
    if payload.component_id:
        relevant.extend(n for n in candidates if n["id"] == payload.component_id and n not in relevant)
    relevant = list({n["id"]: n for n in relevant}.values())[:20]
    evidence = [{"id": f"E{i+1}", "entity_type": n["type"], "entity_id": n["id"], "properties": n, "verification_status": "stored"} for i, n in enumerate(relevant)]
    if not evidence:
        answer = "The saved project history does not contain enough relevant evidence to answer this question. Treat the following as suggestions, not recorded facts: inspect the failing request, compare recent changes, and verify logs and configuration."
    else:
        decisions = [e["properties"] for e in evidence if e["entity_type"] == "Decision"]
        bugs = [e["properties"] for e in evidence if e["entity_type"] == "Bug"]
        components = [e["properties"] for e in evidence if e["entity_type"] == "Component"]
        reasons = [e["properties"] for e in evidence if e["entity_type"] == "Reason"]
        sections = []
        if decisions:
            decision = decisions[0]
            sections.append(f"Stored decision (E{next(i + 1 for i, item in enumerate(evidence) if item['properties']['id'] == decision['id'])}): {decision.get('title', 'A decision was recorded')}.")
            if decision.get("reason"):
                sections.append(f"Recorded reason: {decision['reason']}.")
        elif reasons:
            sections.append(f"Recorded context: {reasons[0].get('description', '')}.")
        if components:
            sections.append(f"The related component is {components[0].get('title', components[0].get('name', 'not named'))}.")
        if bugs:
            bug = bugs[0]
            sections.append(f"Related stored bug (E{next(i + 1 for i, item in enumerate(evidence) if item['properties']['id'] == bug['id'])}): {bug.get('title', 'A bug was recorded')}.")
        sections.append("This history makes the records relevant to the current question, but it does not prove that the current error has the same root cause.")
        answer = " ".join(sections)
    edge_ids = {n["id"] for n in relevant}
    return {"answer": answer, "fallback": not bool(settings.gemini_api_key), "evidence": evidence, "graph": [e for e in store.edges if e["source"] in edge_ids or e["target"] in edge_ids], "suggested_steps": ["Confirm the affected component and exact error", "Compare the current configuration with the recorded fix", "Run a focused regression test"]}


@app.get("/api/projects/{project_id}/graph")
def graph(
    project_id: str,
    q: str | None = Query(default=None, max_length=200),
    node_type: str | None = Query(default=None, max_length=50),
    relationship_type: str | None = Query(default=None, max_length=80),
) -> dict[str, Any]:
    get_project(project_id)
    nodes = store.project_nodes(project_id)
    ids = {n["id"] for n in nodes} | {project_id}
    selected_nodes = [n for n in store.nodes.values() if n["id"] in ids]
    if node_type:
        selected_nodes = [n for n in selected_nodes if n["type"].lower() == node_type.lower()]
    if q:
        needle = q.lower()
        selected_nodes = [n for n in selected_nodes if any(needle in str(value).lower() for value in n.values())]
    selected_ids = {n["id"] for n in selected_nodes}
    selected_edges = [e for e in store.edges if e["source"] in selected_ids and e["target"] in selected_ids]
    if relationship_type:
        selected_edges = [e for e in selected_edges if e["type"].lower() == relationship_type.lower()]
    return {"nodes": selected_nodes, "edges": selected_edges}


@app.get("/api/projects/{project_id}/graph/nodes/{node_id}")
def graph_node(project_id: str, node_id: str) -> dict[str, Any]:
    get_project(project_id)
    node = store.nodes.get(node_id)
    if not node or node.get("project_id") not in {project_id, ""}:
        raise HTTPException(404, "Graph node not found in project")
    edges = [edge for edge in store.edges if edge["source"] == node_id or edge["target"] == node_id]
    connected_ids = {edge["source"] for edge in edges} | {edge["target"] for edge in edges}
    connected_ids.discard(node_id)
    connected = [store.nodes[item_id] for item_id in connected_ids if item_id in store.nodes and store.nodes[item_id].get("project_id") in {project_id, ""}]
    return {"node": node, "edges": edges, "connected": connected}


@app.get("/api/projects/{project_id}/graph/relationships/{relationship_id}")
def graph_relationship(project_id: str, relationship_id: str) -> dict[str, Any]:
    get_project(project_id)
    try:
        index = int(relationship_id)
        edge = [item for item in store.edges if item["source"] in {n["id"] for n in store.project_nodes(project_id)}][index]
    except (ValueError, IndexError):
        raise HTTPException(404, "Graph relationship not found")
    source = store.nodes.get(edge["source"])
    target = store.nodes.get(edge["target"])
    if not source or not target:
        raise HTTPException(404, "Graph relationship not found")
    return {"relationship": edge, "source": source, "target": target}


@app.get("/api/projects/{project_id}/graph/paths")
def graph_path(project_id: str, source: str, target: str, max_hops: int = Query(default=4, ge=1, le=8)) -> dict[str, Any]:
    get_project(project_id)
    project_ids = {node["id"] for node in store.project_nodes(project_id)} | {project_id}
    if source not in project_ids or target not in project_ids:
        raise HTTPException(404, "Path nodes must belong to project")
    queue: list[tuple[str, list[dict[str, Any]]]] = [(source, [])]
    visited = {source}
    while queue:
        current, path_edges = queue.pop(0)
        if current == target:
            ids = {source, target} | {item["source"] for item in path_edges} | {item["target"] for item in path_edges}
            return {"nodes": [store.nodes[item_id] for item_id in ids], "edges": path_edges}
        if len(path_edges) >= max_hops:
            continue
        for edge in store.edges:
            if edge["source"] == current:
                neighbor = edge["target"]
            elif edge["target"] == current:
                neighbor = edge["source"]
            else:
                continue
            if neighbor in project_ids and neighbor not in visited:
                visited.add(neighbor)
                queue.append((neighbor, path_edges + [edge]))
    return {"nodes": [], "edges": []}


@app.get("/api/projects/{project_id}/graph/neighbors/{node_id}")
def graph_neighbors(project_id: str, node_id: str, depth: int = Query(default=1, ge=1, le=3)) -> dict[str, Any]:
    get_project(project_id)
    if node_id not in store.nodes or store.nodes[node_id].get("project_id") not in {project_id, ""}:
        raise HTTPException(404, "Graph node not found in project")
    ids = {node_id}
    for _ in range(depth):
        ids.update(edge["target"] for edge in store.edges if edge["source"] in ids)
        ids.update(edge["source"] for edge in store.edges if edge["target"] in ids)
    ids = {node_id for node_id in ids if store.nodes.get(node_id, {}).get("project_id") == project_id or node_id == project_id}
    return {"nodes": [store.nodes[node_id] for node_id in ids], "edges": [edge for edge in store.edges if edge["source"] in ids and edge["target"] in ids]}
