"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminTableSkeleton } from "../admin-ui";

type AdminUser = {
  id: string;
  email: string;
  role: "owner" | "admin";
  status: "active" | "revoked";
  granted_at: string;
  revoked_at: string | null;
};

export default function AdminUsersPage() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "admin">("admin");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/admin-users")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((d: { admins: AdminUser[] }) => setAdmins(d.admins))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/admin-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setNotice(`Added ${email}.`);
      setEmail("");
      setRole("admin");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add admin.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (admin: AdminUser) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/admin-users/${admin.id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setNotice(`Revoked ${admin.email}.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke admin.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={addAdmin}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-800 bg-gray-900/50 p-4"
      >
        <div className="flex flex-col">
          <label className="mb-1 text-xs font-semibold text-gray-400">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@example.com"
            className="w-64 rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
          />
        </div>
        <div className="flex flex-col">
          <label className="mb-1 text-xs font-semibold text-gray-400">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "owner" | "admin")}
            className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
          >
            <option value="admin">admin</option>
            <option value="owner">owner</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
        >
          Add admin
        </button>
      </form>

      {notice ? <p className="text-sm text-emerald-400">{notice}</p> : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {loading ? (
        <AdminTableSkeleton rows={5} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-900/60 text-[11px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Email</th>
                <th className="px-4 py-2 font-semibold">Role</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Granted</th>
                <th className="px-4 py-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {admins.map((a) => (
                <tr key={a.id} className="text-gray-300">
                  <td className="px-4 py-2">{a.email}</td>
                  <td className="px-4 py-2">{a.role}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        a.status === "active"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-gray-700 text-gray-400"
                      }`}
                    >
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-500">
                    {new Date(a.granted_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {a.status === "active" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => revoke(a)}
                        className="rounded-md border border-gray-700 px-3 py-1 text-xs text-gray-300 transition-colors hover:border-red-500 hover:text-red-400 disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    ) : (
                      <span className="text-xs text-gray-600">revoked</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-600">
        The last active admin cannot be revoked. Revoking is a soft remove (kept for audit).
      </p>
    </div>
  );
}
