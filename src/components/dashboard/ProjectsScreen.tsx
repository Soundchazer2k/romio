// SPDX-License-Identifier: GPL-3.0
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Plus, FolderOpen, Clock, AlertTriangle } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@/stores";
import { ipc } from "@/lib/ipc";
import type { CreateProjectRequest, FrontendInfo } from "@/types";

export function ProjectsScreen() {
  const { setActiveProject, setScreen, setRomioState } = useAppStore();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn:  () => ipc.listProjects(),
  });

  const { data: frontends = [] } = useQuery({
    queryKey: ["frontends"],
    queryFn:  () => ipc.getSupportedFrontends(),
  });

  const createMut = useMutation({
    mutationFn: (req: CreateProjectRequest) => ipc.createProject(req),
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setActiveProject(project);
      setRomioState("pondering");
      setScreen("preflight");
    },
  });

  function openProject(id: string) {
    ipc.getProject(id).then((p) => {
      setActiveProject(p);
      setRomioState("pondering");
      setScreen("preflight");
    });
  }

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-romio-cream">Projects</h1>
          <p className="text-romio-gray text-sm mt-0.5">
            Each project maps one or more library roots to a target frontend.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm
                     bg-romio-green text-white hover:bg-romio-green/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Project
        </button>
      </div>

      {/* Existing projects */}
      {isLoading ? (
        <div className="text-romio-gray text-sm">Loading…</div>
      ) : projects.length === 0 ? (
        <EmptyState onNew={() => setShowNew(true)} />
      ) : (
        <div className="grid gap-3">
          {projects.map((p, i) => (
            <motion.button
              key={p.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => openProject(p.id)}
              className="w-full text-left px-5 py-4 rounded-xl border border-border
                         bg-romio-surface hover:border-romio-green/40 hover:bg-romio-green/5
                         transition-all group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-romio-cream group-hover:text-romio-green
                                transition-colors truncate">
                    {p.name}
                  </p>
                  <p className="text-xs text-romio-gray mt-0.5 truncate">
                    {p.libraryRoots.join(" · ")}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 text-right flex-shrink-0">
                  {p.scanStats && p.scanStats.blockingIssues > 0 && (
                    <span className="flex items-center gap-1 text-xs text-romio-red">
                      <AlertTriangle className="w-3 h-3" />
                      {p.scanStats.blockingIssues} blocking
                    </span>
                  )}
                  {p.lastScannedAt && (
                    <span className="flex items-center gap-1 text-xs text-romio-gray">
                      <Clock className="w-3 h-3" />
                      {new Date(p.lastScannedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                {p.targetFrontends.map((f) => (
                  <span key={f} className="px-2 py-0.5 text-xs rounded-full
                                           bg-romio-green/10 text-romio-green border
                                           border-romio-green/20">
                    {f}
                  </span>
                ))}
              </div>
            </motion.button>
          ))}
        </div>
      )}

      {/* New project modal */}
      {showNew && (
        <NewProjectModal
          frontends={frontends}
          onSubmit={(req) => createMut.mutate(req)}
          onClose={() => setShowNew(false)}
          isPending={createMut.isPending}
        />
      )}
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
      <img src="/romio/romio_idle.png" alt="No projects" className="w-24 h-24 opacity-60" />
      <p className="text-romio-gray">No projects yet. Create one to get started.</p>
      <button
        onClick={onNew}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                   bg-white/5 text-romio-cream hover:bg-white/10 transition-colors border border-border"
      >
        <Plus className="w-4 h-4" /> Create first project
      </button>
    </div>
  );
}

function NewProjectModal({
  frontends, onSubmit, onClose, isPending
}: {
  frontends:  FrontendInfo[];
  onSubmit:   (req: CreateProjectRequest) => void;
  onClose:    () => void;
  isPending:  boolean;
}) {
  const [name, setName] = useState("");
  const [roots, setRoots] = useState<string[]>([]);
  const [selectedFrontends, setSelectedFrontends] = useState<string[]>(["esde"]);

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: true, title: "Select library root(s)" });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      setRoots((prev) => [...new Set([...prev, ...paths])]);
    }
  }

  function toggleFrontend(id: string) {
    setSelectedFrontends((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
    );
  }

  function submit() {
    if (!name.trim() || roots.length === 0) return;
    onSubmit({ name: name.trim(), libraryRoots: roots, targetFrontends: selectedFrontends });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-romio-surface border border-border rounded-2xl
                   shadow-romio p-6 space-y-5"
      >
        <h2 className="text-lg font-bold text-romio-cream">New Project</h2>

        {/* Name */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-romio-gray uppercase tracking-wider">
            Project Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Retro Library"
            className="w-full px-3 py-2 rounded-lg bg-black/30 border border-border
                       text-romio-cream text-sm placeholder:text-romio-gray/50
                       focus:outline-none focus:border-romio-green/50"
          />
        </div>

        {/* Library roots */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-romio-gray uppercase tracking-wider">
            Library Roots
          </label>
          <div className="space-y-1">
            {roots.map((r) => (
              <div key={r} className="flex items-center gap-2 px-3 py-1.5 rounded-lg
                                       bg-black/20 border border-border">
                <FolderOpen className="w-3 h-3 text-romio-gray flex-shrink-0" />
                <span className="text-xs text-romio-cream font-mono truncate flex-1">{r}</span>
                <button onClick={() => setRoots((p) => p.filter((x) => x !== r))}
                  className="text-romio-gray hover:text-romio-red text-xs">✕</button>
              </div>
            ))}
          </div>
          <button onClick={pickFolder}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-romio-gray
                       border border-dashed border-border hover:border-romio-green/40
                       hover:text-romio-cream transition-colors w-full">
            <Plus className="w-3.5 h-3.5" /> Add folder
          </button>
        </div>

        {/* Target frontends */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-romio-gray uppercase tracking-wider">
            Target Frontends
          </label>
          <div className="flex flex-wrap gap-2">
            {frontends.map((f) => (
              <button
                key={f.id}
                onClick={() => toggleFrontend(f.id)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors
                  ${selectedFrontends.includes(f.id)
                    ? "bg-romio-green/15 text-romio-green border-romio-green/40"
                    : "bg-transparent text-romio-gray border-border hover:border-romio-gray"
                  }`}
              >
                {f.name}
                {f.tier === 2 && <span className="ml-1 opacity-50">(T2)</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg text-sm text-romio-gray
                       border border-border hover:bg-white/5 transition-colors">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim() || roots.length === 0 || isPending}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold
                       bg-romio-green text-white hover:bg-romio-green/90
                       disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? "Creating…" : "Create Project"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
