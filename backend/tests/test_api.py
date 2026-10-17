from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_demo_flow_and_project_isolation():
    first = client.post("/api/projects", json={"name": "Auth API"}).json()
    second = client.post("/api/projects", json={"name": "Other API"}).json()
    client.post(f"/api/projects/{first['id']}/components", json={"title": "Authentication Module"})
    client.post(f"/api/projects/{first['id']}/decisions", json={"title": "Use JWT middleware", "reason": "Support API authentication requirements"})
    client.post(f"/api/projects/{first['id']}/bugs", json={"title": "HTTP 401 after authentication update"})
    answer = client.post(f"/api/projects/{first['id']}/assistant/ask", json={"question": "Could JWT authentication be related to HTTP 401?"}).json()
    assert answer["evidence"]
    assert all(item["properties"]["project_id"] == first["id"] for item in answer["evidence"])
    assert client.get(f"/api/projects/{second['id']}/graph").json()["nodes"] == [second]


def test_empty_history_is_honest():
    project = client.post("/api/projects", json={"name": "Empty"}).json()
    response = client.post(f"/api/projects/{project['id']}/assistant/ask", json={"question": "Why did auth fail?"})
    assert "not contain enough" in response.json()["answer"]


def test_graph_views_support_filters_details_and_paths():
    project = client.post("/api/projects", json={"name": "Graph Views"}).json()
    component = client.post(f"/api/projects/{project['id']}/components", json={"title": "Payments"}).json()
    dependency = client.post(f"/api/projects/{project['id']}/dependencies", json={"title": "Stripe", "component_id": component["id"]}).json()
    filtered = client.get(f"/api/projects/{project['id']}/graph", params={"node_type": "Dependency"}).json()
    assert [node["id"] for node in filtered["nodes"]] == [dependency["id"]]
    details = client.get(f"/api/projects/{project['id']}/graph/nodes/{component['id']}").json()
    assert details["node"]["id"] == component["id"]
    assert dependency["id"] in {node["id"] for node in details["connected"]}
    path = client.get(f"/api/projects/{project['id']}/graph/paths", params={"source": project["id"], "target": dependency["id"]}).json()
    assert path["edges"]
