import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlow, Background, Controls, MiniMap, type Edge, type Node } from "@xyflow/react";
import {
  Bell, BrainCircuit, Bug, CheckCircle2, Clock3, Code2, Database,
  FileText, GitBranch, Home, Menu, Network, Plus, Search, Send,
  Settings, ShieldCheck, Sparkles, UserRound, Wrench, X
} from "lucide-react";
import "./styles.css";
import "@xyflow/react/dist/style.css";

const API = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000/api";
type Project = { id: string; name: string; description?: string; counts?: Record<string, number> };
type Evidence = { id: string; entity_type: string; properties: Record<string, string> };
type Answer = { answer: string; evidence: Evidence[]; fallback: boolean };

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project>();
  const [question, setQuestion] = useState("Why did we change authentication, and could it relate to an HTTP 401?");
  const [answer, setAnswer] = useState<Answer>();
  const [graph, setGraph] = useState<{ nodes: Array<Record<string, string>>; edges: Array<Record<string, string>> }>({ nodes: [], edges: [] });
  const [busy, setBusy] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [projectError, setProjectError] = useState("");
  const [savingProject, setSavingProject] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<Record<string, string>>>([]);
  const [activePage, setActivePage] = useState("Dashboard");
  const [pageRecords, setPageRecords] = useState<Array<Record<string, string>>>([]);
  const [memoryType, setMemoryType] = useState("components");
  const [memoryTitle, setMemoryTitle] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [notifications, setNotifications] = useState<Array<Record<string, string>>>([]);

  useEffect(() => {
    fetch(`${API}/projects`).then(r => r.json()).then((items: Project[]) => {
      setProjects(items);
      setProject(items[0]);
    });
  }, []);
  useEffect(() => {
    if (project) fetch(`${API}/projects/${project.id}/graph`).then(r => r.json()).then(setGraph);
  }, [project]);
  useEffect(() => {
    if (!project) return;
    fetch(`${API}/projects/${project.id}/timeline`)
      .then(response => response.ok ? response.json() : [])
      .then((items: Array<Record<string, string>>) => setNotifications(items.slice(0, 5)))
      .catch(() => setNotifications([]));
  }, [project, graph]);
  useEffect(() => {
    if (!project || activePage === "Dashboard" || activePage === "AI Assistant" || activePage === "Knowledge Graph" || activePage === "Add Memory" || activePage === "Settings") return;
    const endpoint = activePage === "Timeline" ? "timeline" : memoryType;
    fetch(`${API}/projects/${project.id}/${endpoint}`).then(r => r.json()).then(setPageRecords).catch(() => setPageRecords([]));
  }, [project, activePage, memoryType]);
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setShowAssistant(value => !value);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      fetch(`${API}/search?q=${encodeURIComponent(searchQuery.trim())}`)
        .then(response => response.json())
        .then(setSearchResults)
        .catch(() => setSearchResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);
  async function ask(prompt = question) {
    if (!project || !prompt.trim()) return;
    setQuestion(prompt);
    setBusy(true);
    try {
      const response = await fetch(`${API}/projects/${project.id}/assistant/ask`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: prompt })
      });
      setAnswer(await response.json());
    } finally { setBusy(false); }
  }
  async function createProject() {
    if (!newProjectName.trim()) {
      setProjectError("Project name is required.");
      return;
    }
    setSavingProject(true);
    setProjectError("");
    try {
      const response = await fetch(`${API}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProjectName.trim(), description: newProjectDescription.trim() })
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail ?? "Unable to create project.");
      }
      const created = await response.json() as Project;
      setProjects(current => [...current, created]);
      setProject(created);
      setNewProjectName("");
      setNewProjectDescription("");
      setShowNewProject(false);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Unable to create project.");
    } finally {
      setSavingProject(false);
    }
  }
  const counts = project?.counts ?? {};
  const memoryCount = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><BrainCircuit size={25} /></span><div><b>DevMind AI</b><small>AI Developer Assistant with Project Memory</small></div></div>
      <nav className="side-nav">
        <a className={activePage === "Dashboard" ? "selected" : ""} onClick={() => setActivePage("Dashboard")}><Home size={17} />Dashboard</a>
        <a className={activePage === "AI Assistant" ? "selected" : ""} onClick={() => { setActivePage("AI Assistant"); setShowAssistant(true); }}><Sparkles size={17} />AI Assistant</a>
        <a className={activePage === "Knowledge Graph" ? "selected" : ""} onClick={() => setActivePage("Knowledge Graph")}><Network size={17} />Knowledge Graph</a>
        <a className={activePage === "Project Memory" ? "selected" : ""} onClick={() => setActivePage("Project Memory")}><Database size={17} />Project Memory</a>
        <a className={activePage === "Timeline" ? "selected" : ""} onClick={() => setActivePage("Timeline")}><Clock3 size={17} />Timeline</a>
        <a className={activePage === "Add Memory" ? "selected" : ""} onClick={() => setActivePage("Add Memory")}><Plus size={18} />Add Memory</a>
        <a className={activePage === "Settings" ? "selected" : ""} onClick={() => setActivePage("Settings")}><Settings size={17} />Settings</a>
      </nav>
      <div className="sidebar-callout"><Network size={24} /><b>Graph-Powered<br />Better Debugging</b><p>Connect your project history.<br />Get smarter answers.</p></div>
    </aside>
    <div className="main-area">
      <header className="topbar">
        <button className="mobile-menu"><Menu size={19} /></button>
        <div className="search-container"><div className="search"><Search size={16} /><input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search projects, components, decisions, bugs..." /><kbd>⌘ K</kbd></div>{searchQuery && <div className="search-results">{searchResults.length ? searchResults.map(result => <button key={result.id} onClick={() => { const selected = projects.find(item => item.id === result.project_id) ?? (result.type === "Project" ? projects.find(item => item.id === result.id) : undefined); if (selected) setProject(selected); setActivePage(result.type === "Project" ? "Dashboard" : "Project Memory"); setSearchQuery(""); }}><span>{result.type}</span><b>{result.name ?? result.title ?? result.description ?? "Record"}</b></button>) : <div className="search-empty">No matching records found.</div>}</div>}</div>
        <select className="top-project" value={project?.id ?? ""} onChange={e => setProject(projects.find(p => p.id === e.target.value))}>
          {projects.length ? projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>) : <option value="">Developer Assistant</option>}
        </select>
        <div className="top-action">
          <button className={`top-icon-button ${showNotifications ? "active" : ""}`} aria-label="Open notifications" onClick={() => { setShowNotifications(value => !value); setShowProfile(false); }}><Bell size={18} />{notifications.length > 0 && <span className="notification-badge">{notifications.length}</span>}</button>
          {showNotifications && <div className="top-dropdown notification-dropdown"><div className="dropdown-heading"><b>Notifications</b><span>{notifications.length} recent</span></div>{notifications.length ? notifications.map(item => <button className="notification-item" key={item.id} onClick={() => { setActivePage("Timeline"); setShowNotifications(false); }}><span>{item.type}</span><b>{item.title}</b><small>{item.created_at}</small></button>) : <div className="dropdown-empty">No recent project activity.</div>}</div>}
        </div>
        <div className="top-action">
          <button className={`avatar ${showProfile ? "active" : ""}`} aria-label="Open profile menu" onClick={() => { setShowProfile(value => !value); setShowNotifications(false); }}><UserRound size={15} /></button>
          {showProfile && <div className="top-dropdown profile-dropdown"><div className="profile-summary"><div className="profile-avatar">JD</div><div><b>Local Demo User</b><small>Developer workspace</small></div></div><button onClick={() => { setActivePage("Settings"); setShowProfile(false); }}><Settings size={14} />Settings</button><button onClick={() => { setActivePage("AI Assistant"); setShowAssistant(true); setShowProfile(false); }}><Sparkles size={14} />Open AI Assistant</button><button onClick={() => { setActivePage("Dashboard"); setShowProfile(false); }}><Home size={14} />Back to Dashboard</button></div>}
        </div>
      </header>
      {activePage === "Dashboard" ? <main className="dashboard">
        <div className="page-heading"><div><h1>Dashboard</h1><p>Overview of your project memory and development knowledge graph</p></div><button className="primary" onClick={() => { setProjectError(""); setShowNewProject(true); }}><Plus size={16} /> New Project</button></div>
        <section className="metric-grid">
          <Metric icon={<FileText />} tone="blue" label="Projects" value={projects.length || 1} note="Active projects" trend="↑ 100%" />
          <Metric icon={<Code2 />} tone="royal" label="Components" value={counts.component ?? 1} note="Across all projects" trend="↑ 71%" />
          <Metric icon={<FileText />} tone="green" label="Decisions" value={counts.decision ?? 1} note="Technical decisions" trend="↑ 67%" />
          <Metric icon={<Bug />} tone="red" label="Bugs" value={counts.bug ?? 1} note="Total reported" trend="↑ 60%" />
          <Metric icon={<CheckCircle2 />} tone="teal" label="Resolved Bugs" value={counts.fix ?? 0} note="Fixed and closed" trend="↑ 75%" />
          <Metric icon={<GitBranch />} tone="royal" label="Dependencies" value={counts.dependency ?? 0} note="Tracked packages" trend="LIVE" />
        </section>
        <section className="content-grid">
          <div className="left-column">
            <PanelTitle title="Project Overview" action={<select className="panel-select" value={project?.id ?? ""} onChange={e => setProject(projects.find(p => p.id === e.target.value))}><option>{project?.name ?? "Developer Assistant"}</option></select>} />
            <div className="overview-card"><Donut /><div className="legend-list"><Legend color="blue" label="Components" value={counts.component ?? 12} /><Legend color="cyan" label="Decisions" value={counts.decision ?? 5} /><Legend color="orange" label="Bugs" value={counts.bug ?? 8} /><Legend color="purple" label="Fixes" value={counts.fix ?? 6} /><Legend color="violet" label="Dependencies" value={counts.dependency ?? 14} /></div></div>
            <div className="panel activity-chart"><PanelTitle title="Project Activity" action={<select className="panel-select"><option>Last 7 days</option></select>} /><div className="chart"><div className="grid-lines"><i /><i /><i /><i /><i /></div><svg viewBox="0 0 620 170" preserveAspectRatio="none"><polyline points="0,130 95,110 190,96 285,108 380,65 475,45 620,80" /><polyline className="line-red" points="0,145 95,115 190,100 285,106 380,98 475,86 620,110" /><polyline className="line-green" points="0,155 95,140 190,145 285,139 380,130 475,118 620,137" /></svg><div className="chart-labels"><span>Apr 23</span><span>Apr 24</span><span>Apr 25</span><span>Apr 26</span><span>Apr 27</span><span>Apr 28</span><span>Apr 29</span></div></div><div className="chart-legend"><span className="blue-dot" />Decisions <span className="red-dot" />Bugs <span className="green-dot" />Fixes <span className="purple-dot" />Dependencies</div></div>
          </div>
          <div className="middle-column">
            <ActivityPanel title="Recent Activity" items={[["decision", "Decision created", "Use JWT authentication middleware", "2 hours ago"], ["bug", "Bug reported", "API returns HTTP 401", "4 hours ago"], ["fix", "Fix applied", "Correct token validation and signing secret", "5 hours ago"], ["dependency", "Dependency updated", "jwt-middleware v2.1.0", "1 day ago"], ["component", "Component modified", "Authentication Module", "1 day ago"]]} />
            <ActivityPanel title="Latest Memories" items={[["dependency", "JWT middleware dependency updated", "Dependency · 1h ago", ""], ["decision", "Authentication module design decision", "Decision · 2h ago", ""], ["bug", "HTTP 401 error reported", "Bug · 4h ago", ""], ["fix", "Token validation fix applied", "Fix · 5h ago", ""], ["component", "User service depends on auth module", "Component · 1d ago", ""]]} />
          </div>
          <aside className="right-column">
            <div className="quick-panel"><h3>Quick Actions</h3><QuickAction icon={<Sparkles />} title="Ask AI Assistant" text="Get answers from your project memory" onClick={() => setShowAssistant(true)} /><QuickAction icon={<Network />} title="Explore Knowledge Graph" text="Visualize relationships and connections" /><QuickAction icon={<Clock3 />} title="View Timeline" text="See project history and events" /><QuickAction icon={<Plus />} title="Add Memory" text="Save decisions, bugs, fixes and more" /></div>
            <div className="quick-panel accessed"><h3>Frequently Accessed</h3><QuickAction icon={<FileText />} title="Authentication Module" text="Component · 2h ago" /><QuickAction icon={<CheckCircle2 />} title="Use JWT authentication middleware" text="Decision · 3h ago" /><QuickAction icon={<Bug />} title="API returns HTTP 401" text="Bug · 4h ago" /><QuickAction icon={<Wrench />} title="Correct token validation and signing secret" text="Fix · 5h ago" /><QuickAction icon={<Code2 />} title="jwt-middleware v2.1.0" text="Dependency · 1d ago" /></div>
          </aside>
        </section>
      </main> : <PageView activePage={activePage} project={project} graph={graph} records={pageRecords} memoryType={memoryType} setMemoryType={setMemoryType} title={memoryTitle} setTitle={setMemoryTitle} onSaved={() => { setMemoryTitle(""); setActivePage("Project Memory"); }} onAsk={() => setShowAssistant(true)} />}
      <footer><span><i className="online" /> Neo4j Connected</span><span><Sparkles size={13} /> AI Provider: Gemini</span><span className="ready"><i className="online" /> Ready</span></footer>
    </div>
    <button className="copilot-launcher" aria-label="Ask DevMind (Ctrl or Cmd plus J)" onClick={() => setShowAssistant(true)}><Sparkles size={17} /><span>Ask DevMind</span><kbd>⌘ J</kbd></button>
    {showAssistant && <div className="modal-backdrop"><div className="assistant-modal"><button className="close" aria-label="Close assistant" onClick={() => setShowAssistant(false)}><X /></button><div className="modal-kicker">DEVMIND AI COPILOT · {activePage.toUpperCase()}</div><h2>Ask about {project?.name ?? "your project"}</h2><p className="copilot-context">Answers use the active project graph, stored memories, and the current {activePage} page. Historical facts are separated from hypotheses.</p><div className="copilot-actions"><button className="secondary" onClick={() => ask(`Explain this ${activePage} page for ${project?.name ?? "the active project"}. Include important stored facts and useful next steps.`)}>Explain this page</button><button className="secondary" onClick={() => ask(`Explain the complete architecture and connected memories for ${project?.name ?? "the active project"}.`)}>Explain my project</button><button className="secondary" onClick={() => ask("What previous bug, decision, dependency, and fix are most relevant to debugging the current project?")}>Debug with history</button></div><textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask about any project, component, dependency, decision, bug, fix, graph relationship, or page..." /><button className="primary ask-button" onClick={() => ask()} disabled={busy}>{busy ? "Retrieving evidence..." : "Ask DevMind"} <Send size={16} /></button>{answer && <div className="modal-answer"><small>{answer.fallback ? "RULE-BASED FALLBACK · STORED EVIDENCE" : "AI RESPONSE · STORED EVIDENCE"}</small><p>{answer.answer}</p><b>{answer.evidence.length} evidence records found</b><div className="modal-evidence">{answer.evidence.map(e => <div className="modal-evidence-card" key={e.id}><span>{e.id}</span><div><b>{e.entity_type}</b><p>{e.properties.title ?? e.properties.name ?? e.properties.description}</p>{e.properties.reason && <small>Reason: {e.properties.reason}</small>}{e.properties.error_message && <small>Error: {e.properties.error_message}</small>}</div></div>)}</div></div>}</div></div>}
    {showNewProject && <div className="modal-backdrop"><div className="assistant-modal project-modal"><button className="close" onClick={() => setShowNewProject(false)}><X /></button><div className="modal-kicker">PROJECT MANAGEMENT</div><h2>Create a new project</h2><label className="modal-label">Project name<input value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder="e.g. Payments API" autoFocus /></label><label className="modal-label">Description<textarea value={newProjectDescription} onChange={e => setNewProjectDescription(e.target.value)} placeholder="What does this project do?" /></label>{projectError && <p className="form-error">{projectError}</p>}<button className="primary ask-button" onClick={createProject} disabled={savingProject}>{savingProject ? "Creating..." : "Create project"} <Plus size={16} /></button></div></div>}
  </div>;
}
function Metric({ icon, tone, label, value, note, trend }: { icon: React.ReactNode; tone: string; label: string; value: string | number; note: string; trend: string }) { return <div className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><div className="metric-copy"><span>{label}</span><b>{value}</b><small>{note}</small></div><em>{trend}</em></div>; }
function PanelTitle({ title, action }: { title: string; action?: React.ReactNode }) { return <div className="panel-title"><h3>{title}</h3>{action ?? <a>View all →</a>}</div>; }
function Legend({ color, label, value }: { color: string; label: string; value: string | number }) { return <div className="legend-row"><i className={color} /> <span>{label}</span><b>{value}</b></div>; }
function Donut() { return <div className="donut"><div><b>2</b><small>Total Projects</small></div></div>; }
function ActivityPanel({ title, items }: { title: string; items: string[][] }) { return <div className="activity-panel"><PanelTitle title={title} />{items.map(([kind, heading, text, time], index) => <div className="activity-row" key={`${heading}-${index}`}><div className={`activity-icon ${kind}`}><IconFor kind={kind} /></div><div><b>{heading}</b><span>{text}</span></div>{time && <small>{time}</small>}</div>)}</div>; }
function IconFor({ kind }: { kind: string }) { return kind === "bug" ? <Bug /> : kind === "fix" ? <Wrench /> : kind === "dependency" ? <GitBranch /> : kind === "component" ? <Code2 /> : <FileText />; }
function QuickAction({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick?: () => void }) { return <button className="quick-action" onClick={onClick}><span>{icon}</span><div><b>{title}</b><small>{text}</small></div></button>; }
function PageView({ activePage, project, graph, records, memoryType, setMemoryType, title, setTitle, onSaved, onAsk }: {
  activePage: string; project?: Project; graph: { nodes: Array<Record<string, string>>; edges: Array<Record<string, string>> };
  records: Array<Record<string, string>>; memoryType: string; setMemoryType: (value: string) => void;
  title: string; setTitle: (value: string) => void; onSaved: () => void; onAsk: () => void;
}) {
  const [health, setHealth] = useState<Record<string, string>>();
  async function saveMemory() {
    if (!project || !title.trim()) return;
    await fetch(`${API}/projects/${project.id}/${memoryType}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    onSaved();
  }
  if (activePage === "AI Assistant") return <main className="subpage"><PageHeader title="AI Assistant" subtitle="Ask questions grounded in your saved project memory." /><button className="primary" onClick={onAsk}><Sparkles size={16} /> Open assistant</button></main>;
  if (activePage === "Knowledge Graph") {
    return <GraphWorkspace project={project} graph={graph} onAsk={onAsk} />;
  }
  if (activePage === "Add Memory") return <main className="subpage"><PageHeader title="Add Memory" subtitle="Save a decision, bug, dependency, or component to the active project." /><div className="form-card"><label>Memory type<select value={memoryType} onChange={e => setMemoryType(e.target.value)}><option value="components">Component</option><option value="dependencies">Dependency</option><option value="decisions">Decision</option><option value="bugs">Bug report</option></select></label><label>Title<input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Authentication Module" /></label><button className="primary" onClick={saveMemory} disabled={!title.trim()}><Plus size={16} /> Save memory</button></div></main>;
  if (activePage === "Settings") return <main className="subpage"><PageHeader title="Settings" subtitle="Environment and provider status for this local workspace." /><button className="secondary" onClick={() => fetch(`${API}/health`).then(r => r.json()).then(setHealth)}>Refresh health</button>{health && <div className="settings-card"><p><b>Application:</b> {health.status}</p><p><b>Database:</b> {health.database}</p><p><b>AI provider:</b> {health.ai_provider}</p><p><b>AI available:</b> {health.ai_available ? "Yes" : "No — using labeled fallback"}</p></div>}</main>;
  const isTimeline = activePage === "Timeline";
  return <main className="subpage"><PageHeader title={isTimeline ? "Timeline" : "Project Memory"} subtitle={isTimeline ? "Chronological activity from the active project." : "Browse and inspect records saved for the active project."} />{!isTimeline && <div className="tabs">{["components", "dependencies", "decisions", "bugs"].map(type => <button className={memoryType === type ? "tab-active" : ""} onClick={() => setMemoryType(type)} key={type}>{type}</button>)}</div>}<div className="records">{records.length ? records.map(record => <div className="record-card" key={record.id}><span>{record.type ?? record.event_type}</span><b>{record.title ?? record.name ?? record.description}</b><small>{record.created_at}</small></div>) : <Empty text={isTimeline ? "No activity recorded yet." : "No records in this category yet."} />}</div></main>;
}
type GraphWorkspaceProps = {
  project?: Project;
  graph: { nodes: Array<Record<string, string>>; edges: Array<Record<string, string>> };
  onAsk: () => void;
};
type GraphMode = "Graph" | "Table" | "Cards" | "Architecture Flow" | "Relationship Explorer" | "Timeline" | "AI Explanation" | "Raw Data";

function GraphWorkspace({ project, graph: initialGraph, onAsk }: GraphWorkspaceProps) {
  const [graph, setGraph] = useState(initialGraph);
  const [mode, setMode] = useState<GraphMode>("Graph");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [relationshipFilter, setRelationshipFilter] = useState("All");
  const [selectedId, setSelectedId] = useState("");
  const [selectedEdge, setSelectedEdge] = useState<Record<string, string>>();
  const [timeline, setTimeline] = useState<Array<Record<string, string>>>([]);
  const [explanation, setExplanation] = useState("");
  const [loadingExplanation, setLoadingExplanation] = useState(false);
  const [tableTab, setTableTab] = useState<"Nodes" | "Relationships">("Nodes");
  const [page, setPage] = useState(0);
  const modes: GraphMode[] = ["Graph", "Table", "Cards", "Architecture Flow", "Relationship Explorer", "Timeline", "AI Explanation", "Raw Data"];
  const nodeTypes = useMemo(() => ["All", ...Array.from(new Set(graph.nodes.map(node => node.type)))], [graph.nodes]);
  const relationshipTypes = useMemo(() => ["All", ...Array.from(new Set(graph.edges.map(edge => edge.type)))], [graph.edges]);
  const filteredNodes = useMemo(() => graph.nodes.filter(node => {
    const text = Object.values(node).join(" ").toLowerCase();
    return (!query || text.includes(query.toLowerCase())) && (typeFilter === "All" || node.type === typeFilter);
  }), [graph.nodes, query, typeFilter]);
  const filteredEdges = useMemo(() => graph.edges.filter(edge => {
    const source = graph.nodes.find(node => node.id === edge.source);
    const target = graph.nodes.find(node => node.id === edge.target);
    return (relationshipFilter === "All" || edge.type === relationshipFilter)
      && filteredNodes.some(node => node.id === edge.source)
      && filteredNodes.some(node => node.id === edge.target)
      && (!query || `${source?.title ?? source?.name ?? ""} ${target?.title ?? target?.name ?? ""} ${edge.type}`.toLowerCase().includes(query.toLowerCase()));
  }), [graph.edges, graph.nodes, filteredNodes, relationshipFilter, query]);
  const selected = graph.nodes.find(node => node.id === selectedId);

  useEffect(() => {
    setGraph(initialGraph);
  }, [initialGraph]);
  useEffect(() => {
    if (project && mode === "Timeline") fetch(`${API}/projects/${project.id}/timeline`).then(response => response.json()).then(setTimeline).catch(() => setTimeline([]));
  }, [project, mode]);
  useEffect(() => {
    setPage(0);
    setSelectedEdge(undefined);
  }, [query, typeFilter, relationshipFilter, tableTab]);

  async function explain(prompt: string) {
    if (!project) return;
    setLoadingExplanation(true);
    try {
      const response = await fetch(`${API}/projects/${project.id}/assistant/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: prompt, component_id: selectedId || undefined }) });
      const result = await response.json();
      setExplanation(result.answer ?? "No explanation was returned.");
    } finally {
      setLoadingExplanation(false);
    }
  }
  function title(node: Record<string, string>) { return node.title ?? node.name ?? node.description ?? "Record"; }
  function connected(nodeId: string) {
    return graph.edges.filter(edge => edge.source === nodeId || edge.target === nodeId).length;
  }
  const flowNodes: Node[] = filteredNodes.map((node, index) => ({
    id: node.id,
    position: { x: (index % 4) * 230 + 30, y: Math.floor(index / 4) * 140 + 30 },
    data: { label: <div onClick={() => setSelectedId(node.id)}><small>{node.type}</small><b>{title(node)}</b></div> },
    className: `flow-node flow-${node.type?.toLowerCase()}`,
    selected: node.id === selectedId
  }));
  const flowEdges: Edge[] = filteredEdges.map((edge, index) => ({
    id: `${edge.source}-${edge.target}-${index}`,
    source: edge.source,
    target: edge.target,
    label: edge.type,
    animated: edge.source === selectedId || edge.target === selectedId,
    style: { stroke: edge.source === selectedId || edge.target === selectedId ? "#55c7ff" : "#3d78a6" }
  }));
  const rows = tableTab === "Nodes" ? filteredNodes : filteredEdges;
  const pagedRows = rows.slice(page * 10, page * 10 + 10);
  return <main className="subpage graph-workspace">
    <PageHeader title="Knowledge Graph" subtitle="Explore project-scoped Neo4j nodes and relationships in multiple views." />
    <div className="graph-toolbar">
      <select value={mode} onChange={event => setMode(event.target.value as GraphMode)} aria-label="Graph view mode">{modes.map(item => <option key={item}>{item}</option>)}</select>
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search graph nodes..." aria-label="Search graph nodes" />
      <select value={typeFilter} onChange={event => setTypeFilter(event.target.value)} aria-label="Filter node type">{nodeTypes.map(item => <option key={item}>{item}</option>)}</select>
      <select value={relationshipFilter} onChange={event => setRelationshipFilter(event.target.value)} aria-label="Filter relationship type">{relationshipTypes.map(item => <option key={item}>{item}</option>)}</select>
      <span className="graph-count">{filteredNodes.length} nodes · {filteredEdges.length} relationships</span>
    </div>
    {mode === "Graph" && <div className="flow-layout"><div className="react-flow-shell"><ReactFlow nodes={flowNodes} edges={flowEdges} fitView onNodeClick={(_: MouseEvent, node: Node) => setSelectedId(node.id)} onEdgeClick={(_: MouseEvent, edge: Edge) => setSelectedEdge(filteredEdges.find(item => `${item.source}-${item.target}` === edge.id.split("-").slice(0, 2).join("-")))}><Background color="#1b3a5d" gap={24} /><Controls /><MiniMap nodeColor="#2587f1" /></ReactFlow></div><GraphDetails node={selected} edge={selectedEdge} connected={connected} onExplain={() => explain(`Explain the selected graph item ${selected ? title(selected) : selectedEdge?.type ?? ""}. Distinguish stored facts from hypotheses.`)} onExpand={async () => { if (!selected || !project) return; const response = await fetch(`${API}/projects/${project.id}/graph/neighbors/${selected.id}`); if (response.ok) setGraph(await response.json()); }} /></div>}
    {mode === "Architecture Flow" && <ArchitectureFlow nodes={filteredNodes} edges={filteredEdges} selectedId={selectedId} onSelect={setSelectedId} />}
    {mode === "Table" && <TableView tab={tableTab} setTab={setTableTab} rows={pagedRows} total={rows.length} page={page} setPage={setPage} title={title} onSelect={setSelectedId} onEdge={setSelectedEdge} />}
    {mode === "Cards" && <div className="graph-cards">{filteredNodes.map(node => <article className={`graph-card graph-${node.type?.toLowerCase()}`} key={node.id}><small>{node.type}</small><h3>{title(node)}</h3><p>{node.description || "No description recorded."}</p><span>{connected(node.id)} connected entities</span><div><button className="secondary" onClick={() => setSelectedId(node.id)}>View Details</button><button className="secondary" onClick={() => explain(`Explain the graph record ${title(node)} and its relationships.`)}>Explain with AI</button></div></article>)}</div>}
    {mode === "Relationship Explorer" && <RelationshipExplorer node={selected} edges={graph.edges.filter(edge => edge.source === selectedId || edge.target === selectedId)} nodes={graph.nodes} onSelect={setSelectedId} onEdge={setSelectedEdge} />}
    {mode === "Timeline" && <div className="timeline-list">{timeline.length ? timeline.map(event => <article className="record-card" key={event.id}><span>{event.type}</span><b>{event.title}</b><small>{event.created_at}</small></article>) : <Empty text="No timestamped events are available for this project." />}</div>}
    {mode === "AI Explanation" && <section className="explanation-card"><h2>AI graph explanation</h2><p>Use stored project evidence to explain the graph without treating historical relationships as execution order.</p><button className="primary" onClick={() => explain(selected ? `Explain how ${title(selected)} relates to this project graph.` : "Explain the complete project knowledge graph and identify potentially affected components.")}>{loadingExplanation ? "Generating..." : "Explain with AI"}</button>{explanation && <pre>{explanation}</pre>}</section>}
    {mode === "Raw Data" && <pre className="raw-graph-data">{JSON.stringify({ nodes: filteredNodes, relationships: filteredEdges }, null, 2)}</pre>}
  </main>;
}

function GraphDetails({ node, edge, connected, onExplain, onExpand }: { node?: Record<string, string>; edge?: Record<string, string>; connected: (id: string) => number; onExplain: () => void; onExpand: () => void }) {
  if (!node && !edge) return <aside className="graph-details"><Empty text="Select a node or relationship to inspect it." /></aside>;
  return <aside className="graph-details"><div className="panel-title"><h3>{node ? "Node details" : "Relationship details"}</h3><button className="secondary" onClick={onExplain}>Explain with AI</button></div>{node && <><span className="detail-type">{node.type}</span><h2>{node.title ?? node.name ?? "Record"}</h2><p>{node.description || "No description recorded."}</p><small>ID: {node.id}</small><small>{connected(node.id)} connected entities</small><button className="secondary" onClick={onExpand}>Expand neighbors</button></>}{edge && <><span className="detail-type">{edge.type}</span><p>{edge.source} → {edge.target}</p><small>Created: {edge.created_at || "Not recorded"}</small></>}</aside>;
}

function ArchitectureFlow({ nodes, edges, selectedId, onSelect }: { nodes: Array<Record<string, string>>; edges: Array<Record<string, string>>; selectedId: string; onSelect: (id: string) => void }) {
  return <div className="architecture-flow"><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="graph-edges">{edges.map((edge, index) => { const source = nodes.findIndex(node => node.id === edge.source); const target = nodes.findIndex(node => node.id === edge.target); if (source < 0 || target < 0) return null; const sx = 12 + (source % 4) * 25; const sy = 14 + Math.floor(source / 4) * 35; const tx = 12 + (target % 4) * 25; const ty = 14 + Math.floor(target / 4) * 35; return <g key={index}><line x1={sx} y1={sy} x2={tx} y2={ty} /><text x={(sx + tx) / 2} y={(sy + ty) / 2}>{edge.type}</text></g>; })}</svg>{nodes.map((node, index) => <button key={node.id} className={`subpage-node graph-${node.type?.toLowerCase()} ${selectedId === node.id ? "node-selected" : ""}`} style={{ left: `${12 + (index % 4) * 25}%`, top: `${14 + Math.floor(index / 4) * 35}%` }} onClick={() => onSelect(node.id)}><small>{node.type}</small><b>{node.title ?? node.name ?? "Record"}</b></button>)}</div>;
}

function TableView({ tab, setTab, rows, total, page, setPage, title, onSelect, onEdge }: { tab: "Nodes" | "Relationships"; setTab: (tab: "Nodes" | "Relationships") => void; rows: Array<Record<string, string>>; total: number; page: number; setPage: (page: number) => void; title: (node: Record<string, string>) => string; onSelect: (id: string) => void; onEdge: (edge: Record<string, string>) => void }) {
  return <section className="table-view"><div className="tabs"><button className={tab === "Nodes" ? "tab-active" : ""} onClick={() => setTab("Nodes")}>Nodes</button><button className={tab === "Relationships" ? "tab-active" : ""} onClick={() => setTab("Relationships")}>Relationships</button></div><table><thead><tr>{tab === "Nodes" ? <><th>Name</th><th>Type</th><th>ID</th><th>Description</th><th>Actions</th></> : <><th>Source</th><th>Relationship</th><th>Target</th><th>Created</th><th>Actions</th></>}</tr></thead><tbody>{rows.map(row => <tr key={row.id ?? `${row.source}-${row.target}`} onClick={() => tab === "Nodes" ? onSelect(row.id) : onEdge(row)}>{tab === "Nodes" ? <><td>{title(row)}</td><td>{row.type}</td><td>{row.id}</td><td>{row.description || "—"}</td><td><button className="secondary">Details</button></td></> : <><td>{row.source}</td><td>{row.type}</td><td>{row.target}</td><td>{row.created_at || "—"}</td><td><button className="secondary">Details</button></td></>}</tr>)}</tbody></table><div className="pagination"><button className="secondary" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button><span>{total ? page + 1 : 0} / {Math.max(1, Math.ceil(total / 10))}</span><button className="secondary" disabled={(page + 1) * 10 >= total} onClick={() => setPage(page + 1)}>Next</button></div></section>;
}

function RelationshipExplorer({ node, edges, nodes, onSelect, onEdge }: { node?: Record<string, string>; edges: Array<Record<string, string>>; nodes: Array<Record<string, string>>; onSelect: (id: string) => void; onEdge: (edge: Record<string, string>) => void }) {
  if (!node) return <div className="empty-page"><Network size={25} /><b>Select a node in Graph or Cards view first.</b><small>Relationships will appear here.</small></div>;
  return <section className="relationship-explorer"><h2>{node.title ?? node.name ?? "Selected node"}</h2><p>{edges.length} connected relationships</p>{edges.map(edge => { const otherId = edge.source === node.id ? edge.target : edge.source; const other = nodes.find(item => item.id === otherId); return <button className="relationship-row" key={`${edge.source}-${edge.target}-${edge.type}`} onClick={() => { onEdge(edge); onSelect(otherId); }}><span>{edge.source === node.id ? "Outgoing" : "Incoming"}</span><b>{edge.type}</b><strong>{other?.title ?? other?.name ?? otherId}</strong></button>; })}</section>;
}
function PageHeader({ title, subtitle }: { title: string; subtitle: string }) { return <div className="subpage-header"><div><h1>{title}</h1><p>{subtitle}</p></div><span className="page-project"><Database size={14} /> Active project</span></div>; }
function Empty({ text }: { text: string }) { return <div className="empty-page"><Database size={25} /><b>{text}</b><small>Create a record or select another project.</small></div>; }
createRoot(document.getElementById("root")!).render(<App />);
