import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Plus, Trash2, TestTube2, Server, Upload, Download } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import * as XLSX from "xlsx";
import { useRef } from "react";

interface Smtp {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  is_active: boolean;
  last_tested_at: string | null;
  last_used_at: string | null;
  emails_sent: number;
  rotation_order: number;
}

export function SmtpManager() {
  const [smtps, setSmtps] = useState<Smtp[]>([]);
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", host: "", port: "587", username: "", password: "" });
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const { data } = await supabase.from("smtp_accounts").select("*").order("rotation_order");
    setSmtps((data as Smtp[]) ?? []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("smtp-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "smtp_accounts" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const add = async () => {
    if (!form.name || !form.host || !form.username) {
      toast.error("Fill in name, host and username");
      return;
    }
    const port = parseInt(form.port, 10) || 587;
    const order = smtps.length;
    const { error } = await supabase.from("smtp_accounts").insert({
      name: form.name,
      host: form.host,
      port,
      username: form.username,
      password: form.password,
      rotation_order: order,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("SMTP added");
      setOpen(false);
      setForm({ name: "", host: "", port: "587", username: "", password: "" });
    }
  };

  const test = async (s: Smtp) => {
    setTesting(s.id);
    // Enqueue a test request — the external Node worker (worker/) picks it up,
    // runs a real SMTP connection via nodemailer, and writes the result back.
    const { data: req, error } = await supabase
      .from("smtp_test_requests")
      .insert({ smtp_id: s.id })
      .select()
      .single();
    if (error || !req) {
      setTesting(null);
      toast.error(error?.message ?? "Failed to enqueue test");
      return;
    }
    toast.info(`Testing ${s.name}…`);

    // Poll for completion (worker should respond within seconds)
    const started = Date.now();
    while (Date.now() - started < 30_000) {
      await new Promise((r) => setTimeout(r, 1000));
      const { data: row } = await supabase
        .from("smtp_test_requests")
        .select("*")
        .eq("id", req.id)
        .single();
      if (row?.status === "done") {
        setTesting(null);
        if (row.result_ok) toast.success(`${s.name} is active`);
        else toast.error(`${s.name} failed: ${row.error_message ?? "unknown"}`);
        return;
      }
    }
    setTesting(null);
    toast.error(`${s.name}: worker did not respond in 30s. Is the Node worker running?`);
  };

  const testAll = async () => {
    for (const s of smtps) await test(s);
  };

  const remove = async (id: string) => {
    await supabase.from("smtp_accounts").delete().eq("id", id);
    toast.success("SMTP removed");
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["name", "host", "port", "username", "password"],
      ["Mailgun-1", "smtp.mailgun.org", 587, "postmaster@example.com", "your-password"],
      ["SendGrid-1", "smtp.sendgrid.net", 587, "apikey", "SG.xxxxx"],
    ]);
    ws["!cols"] = [{ wch: 18 }, { wch: 24 }, { wch: 8 }, { wch: 30 }, { wch: 24 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SMTP");
    XLSX.writeFile(wb, "smtp-template.xlsx");
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      const norm = (k: string) => k.trim().toLowerCase().replace(/[\s_-]+/g, "");
      const aliases: Record<string, string> = {
        name: "name", label: "name",
        host: "host", server: "host", smtphost: "host",
        port: "port", smtpport: "port",
        username: "username", user: "username", login: "username", email: "username",
        password: "password", pass: "password", pwd: "password", smtppassword: "password",
      };
      const toInsert: Array<{ name: string; host: string; port: number; username: string; password: string; rotation_order: number }> = [];
      const errors: string[] = [];
      const startOrder = smtps.length;
      rows.forEach((raw, idx) => {
        const row: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(raw)) {
          const mapped = aliases[norm(k)];
          if (mapped) row[mapped] = v;
        }
        const name = String(row.name ?? "").trim();
        const host = String(row.host ?? "").trim();
        const username = String(row.username ?? "").trim();
        const password = String(row.password ?? "");
        const port = parseInt(String(row.port ?? "587"), 10) || 587;
        if (!name || !host || !username) {
          errors.push(`Row ${idx + 2}: missing name/host/username`);
          return;
        }
        toInsert.push({ name, host, port, username, password, rotation_order: startOrder + toInsert.length });
      });
      if (toInsert.length === 0) {
        toast.error(errors[0] ?? "No valid rows found");
        return;
      }
      const { error } = await supabase.from("smtp_accounts").insert(toInsert);
      if (error) toast.error(error.message);
      else {
        toast.success(`Imported ${toInsert.length} SMTP${toInsert.length === 1 ? "" : "s"}${errors.length ? ` · ${errors.length} skipped` : ""}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to parse file");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Server className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">SMTP Accounts</h2>
            <p className="text-sm text-muted-foreground">{smtps.length} configured · {smtps.filter((s) => s.is_active).length} active</p>
          </div>
        </div>
        <div className="flex gap-2">
          {smtps.length > 0 && (
            <Button variant="outline" onClick={testAll}>
              <TestTube2 className="h-4 w-4 mr-2" /> Test All
            </Button>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" /> Add SMTP
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add SMTP Account</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Name (label)</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Mailgun-1" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2 space-y-1">
                    <Label>Host</Label>
                    <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="smtp.example.com" />
                  </div>
                  <div className="space-y-1">
                    <Label>Port</Label>
                    <Input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Username</Label>
                  <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Password</Label>
                  <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={add}>Add</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {smtps.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm border-2 border-dashed border-border rounded-lg">
          No SMTP accounts yet. Add one to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {smtps.map((s) => (
            <div key={s.id} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/40 transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <span className={`status-dot ${s.is_active ? "status-dot-active" : s.last_tested_at ? "status-dot-inactive" : "status-dot-idle"}`} />
                <div className="min-w-0">
                  <div className="font-medium truncate">{s.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {s.username}@{s.host}:{s.port}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right text-xs text-muted-foreground hidden md:block">
                  <div>{s.emails_sent} sent</div>
                  <div>{s.last_used_at ? `used ${formatDistanceToNow(new Date(s.last_used_at), { addSuffix: true })}` : "never used"}</div>
                </div>
                <Button size="sm" variant="outline" disabled={testing === s.id} onClick={() => test(s)}>
                  <TestTube2 className="h-3.5 w-3.5 mr-1" />
                  {testing === s.id ? "Testing…" : "Test"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(s.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
