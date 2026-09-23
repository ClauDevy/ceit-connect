// No Supabase, no auth. Pure UI iteration against fake data. Swap the
// mock arrays below for real ones when prototyping a new component, then
// once the component's props are stable, point the real page at
// useTasks()/useEvents() hooks instead.

const mockTasks = [
  { id: "1", title: "Design event banner", status: "TODO", priority: "High" },
  { id: "2", title: "Book venue", status: "IN_PROGRESS", priority: "Medium" },
  { id: "3", title: "Send invites", status: "COMPLETED", priority: "Low" },
];

export default function SandboxPage() {
  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <h1 className="mb-6 text-xl font-bold text-slate-800">
        Sandbox — UI Playground
      </h1>
      <div className="grid gap-4 sm:grid-cols-3">
        {mockTasks.map((task) => (
          <div
            key={task.id}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="text-sm font-semibold text-slate-800">
              {task.title}
            </div>
            <div className="mt-2 text-xs text-slate-500">{task.status}</div>
            <span className="mt-2 inline-block rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-600">
              {task.priority}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
