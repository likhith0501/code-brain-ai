import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.main import settings
from neo4j import GraphDatabase

constraints = [
    "CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (n:Entity) REQUIRE n.id IS UNIQUE",
    "CREATE INDEX project_name IF NOT EXISTS FOR (n:Project) ON (n.name)",
    "CREATE INDEX component_name IF NOT EXISTS FOR (n:Component) ON (n.name)",
    "CREATE INDEX decision_title IF NOT EXISTS FOR (n:Decision) ON (n.title)",
]

if not settings.neo4j_uri:
    raise SystemExit("Configure NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD first.")
driver = GraphDatabase.driver(settings.neo4j_uri, auth=(settings.neo4j_username, settings.neo4j_password))
with driver.session() as session:
    for query in constraints:
        session.run(query).consume()
driver.close()
print("Neo4j constraints and indexes initialized.")
