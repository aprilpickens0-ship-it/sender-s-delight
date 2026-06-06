import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseEmailList } from "@/lib/email-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Plus, Play, Pause, Square, Trash2, Send, Upload, Users, ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { toast } from "sonner";

interface Campaign {
  id: string;
  name: string;
  status: "idle" | "running" | "paused" | "completed";
  delay_seconds: number;
  template_strategy: "sequential" | "random";
  smtp_strategy: "sequential" | "random";
  created_at: string;
}

interface Counts {
  total: number;
  pending: number;
  sent: number;
  failed: number;
}

export function CampaignManager() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [smtps, setSmtps] = useState<{ id: string; name: string; is_active: boolean }[]>([]);
  const [tpls, setTpls] = useState<{ id: string; name: string }[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    delay: "5",
    smtp_strategy: "sequential" as "sequential" | "random",
    template_strategy: "sequential" as "sequential" | "random",
    smtpIds: [] as string[],
    tplIds: [] as string[],
    recipients: "",
  });

  const load = async () => {
    const [c, s, t] = await Promise.all([
      supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
      supabase.from("smtp_accounts").select("id,name,is_active").order("rotation_order"),
      supabase.from("email_templates").select("id,name").order("created_at"),
    ]);
    setCampaigns((c.data as Campaign[]) ?? []);
    setSmtps((s.data as any) ?? []);
    setTpls((t.data as any) ?? []);

    // Counts per campaign
    const { data: rec } = await supabase.from("recipients").select("campaign_id,status");
    const map: Record<string, Counts> = {};
    (rec ?? []).forEach((r: any) => {
      if (!r.campaign_id) return;
      const m = map[r.campaign_id] ?? { total: 0, pending: 0, sent: 0, failed: 0 };
      m.total += 1;
      if (r.status === "pending") m.pending += 1;
      else if (r.status === "sent") m.sent += 1;
      else if (r.status === "failed") m.failed += 1;
      map[r.campaign_id] = m;
    });
    setCounts(map);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("campaigns-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "campaigns" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "recipients" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "smtp_accounts" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "email_templates" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const create = async () => {
    if (!form.name.trim()) return toast.error("Name required");
    if (form.smtpIds.length === 0) return toast.error("Pick at least one SMTP");
    if (form.tplIds.length === 0) return toast.error("Pick at least one template");

    const { data: cam, error } = await supabase
      .from("campaigns")
      .insert({
        name: form.name.trim(),
        delay_seconds: parseInt(form.delay, 10) || 0,
        smtp_strategy: form.smtp_strategy,
        template_strategy: form.template_strategy,
      })
      .select()
      .single();
    if (error || !cam) return toast.error(error?.message ?? "Failed");

    await supabase.from("campaign_smtps").insert(
      form.smtpIds.map((id, i) => ({ campaign_id: cam.id, smtp_id: id, rotation_order: i }))
    );
    await supabase.from("campaign_templates").insert(
      form.tplIds.map((id, i) => ({ campaign_id: cam.id, template_id: id, rotation_order: i }))
    );

    const { valid, invalid } = parseEmailList(form.recipients);
    if (valid.length > 0) {
      const rows = valid.map((email, i) => ({ campaign_id: cam.id, email, position: i }));
      for (let i = 0; i < rows.length; i += 500) {
        await supabase.from("recipients").insert(rows.slice(i, i + 500));
      }
    }

    toast.success(
      `Campaign created${valid.length ? ` with ${valid.length} recipients` : ""}${
        invalid.length ? ` (${invalid.length} invalid skipped)` : ""
      }`
    );
    setOpen(false);
    setForm({
      name: "",
      delay: "5",
      smtp_strategy: "sequential",
      template_strategy: "sequential",
      smtpIds: [],
      tplIds: [],
      recipients: "",
    });
  };

  const start = async (c: Campaign) => {
    // Preflight
    const [{ count: smtpCount }, { count: tplCount }, { count: pending }] = await Promise.all([
      supabase
        .from("campaign_smtps")
        .select("smtp_id,smtp_accounts!inner(is_active)", { count: "exact", head: true })
        .eq("campaign_id", c.id)
        .eq("smtp_accounts.is_active", true),
      supabase
        .from("campaign_templates")
        .select("template_id", { count: "exact", head: true })
        .eq("campaign_id", c.id),
      supabase
        .from("recipients")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", c.id)
        .eq("status", "pending"),
    ]);
    if (!smtpCount) return toast.error("No active SMTPs assigned to this campaign");
    if (!tplCount) return toast.error("No templates assigned to this campaign");
    if (!pending) return toast.error("No pending recipients");

    // Only one running at a time
    const { data: running } = await supabase
      .from("campaigns")
      .select("id,name")
      .eq("status", "running")
      .neq("id", c.id)
      .maybeSingle();
    if (running) return toast.error(`"${running.name}" is already running. Pause it first.`);

    const { error } = await supabase
      .from("campaigns")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", c.id);
    if (error) toast.error(error.message);
    else toast.success("Started");
  };

  const setStatus = async (id: string, status: Campaign["status"]) => {
    await supabase.from("campaigns").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  };

  const reset = async (id: string) => {
    if (!confirm("Reset rotation indices and mark campaign idle?")) return;
    await supabase
      .from("campaigns")
      .update({
        status: "idle",
        current_position: 0,
        smtp_rotation_index: 0,
        template_rotation_index: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this campaign and all its recipients?")) return;
    await supabase.from("campaigns").delete().eq("id", id);
    toast.success("Deleted");
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const txt = await f.text();
    setForm((p) => ({ ...p, recipients: p.recipients ? p.recipients + "\n" + txt : txt }));
    e.target.value = "";
  };

  const toggleId = (key: "smtpIds" | "tplIds", id: string) =>
    setForm((p) => ({
      ...p,
      [key]: p[key].includes(id) ? p[key].filter((x) => x !== id) : [...p[key], id],
    }));

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Send className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Campaigns</h2>
            <p className="text-sm text-muted-foreground">
              {campaigns.length} total · only one campaign can run at a time
            </p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" /> New Campaign
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Campaign</DialogTitle>
              <DialogDescription>
                Pick SMTPs, templates, recipients, and rotation settings.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="April promo"
                />
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>Delay (sec)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.delay}
                    onChange={(e) => setForm({ ...form, delay: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>SMTP rotation</Label>
                  <Select
                    value={form.smtp_strategy}
                    onValueChange={(v: "sequential" | "random") => setForm({ ...form, smtp_strategy: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sequential">Sequential</SelectItem>
                      <SelectItem value="random">Random</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Template rotation</Label>
                  <Select
                    value={form.template_strategy}
                    onValueChange={(v: "sequential" | "random") => setForm({ ...form, template_strategy: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sequential">Sequential</SelectItem>
                      <SelectItem value="random">Random</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>SMTP Accounts ({form.smtpIds.length} selected)</Label>
                <div className="max-h-40 overflow-y-auto rounded-md border border-border divide-y divide-border">
                  {smtps.length === 0 && (
                    <div className="p-3 text-sm text-muted-foreground">No SMTPs configured.</div>
                  )}
                  {smtps.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 p-2.5 text-sm cursor-pointer hover:bg-muted/40">
                      <Checkbox
                        checked={form.smtpIds.includes(s.id)}
                        onCheckedChange={() => toggleId("smtpIds", s.id)}
                      />
                      <span className="flex-1">{s.name}</span>
                      <span className={`text-xs ${s.is_active ? "text-success" : "text-muted-foreground"}`}>
                        {s.is_active ? "active" : "inactive"}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Templates ({form.tplIds.length} selected)</Label>
                <div className="max-h-40 overflow-y-auto rounded-md border border-border divide-y divide-border">
                  {tpls.length === 0 && (
                    <div className="p-3 text-sm text-muted-foreground">No templates yet.</div>
                  )}
                  {tpls.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 p-2.5 text-sm cursor-pointer hover:bg-muted/40">
                      <Checkbox
                        checked={form.tplIds.includes(t.id)}
                        onCheckedChange={() => toggleId("tplIds", t.id)}
                      />
                      <span className="flex-1">{t.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Recipients</Label>
                <Textarea
                  className="min-h-[120px] font-mono text-xs"
                  value={form.recipients}
                  onChange={(e) => setForm({ ...form, recipients: e.target.value })}
                  placeholder="Paste emails (comma, semicolon, or newline separated)…"
                />
                <label className="inline-flex">
                  <input type="file" accept=".csv,.txt" onChange={onFile} className="hidden" />
                  <Button variant="outline" size="sm" asChild>
                    <span className="cursor-pointer">
                      <Upload className="h-4 w-4 mr-2" /> Upload CSV / TXT
                    </span>
                  </Button>
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={create}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {campaigns.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm border-2 border-dashed border-border rounded-lg">
          No campaigns yet. Create one to start sending.
        </div>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => {
            const cn = counts[c.id] ?? { total: 0, pending: 0, sent: 0, failed: 0 };
            const isOpen = expanded === c.id;
            const statusColor = {
              idle: "bg-muted text-muted-foreground",
              running: "bg-success/20 text-success",
              paused: "bg-warning/20 text-warning",
              completed: "bg-primary/20 text-primary",
            }[c.status];
            return (
              <div key={c.id} className="rounded-lg border border-border">
                <div className="flex items-center justify-between p-3">
                  <button
                    onClick={() => setExpanded(isOpen ? null : c.id)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  >
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <div className="min-w-0">
                      <div className="font-medium truncate">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {cn.total} recipients · {cn.pending} pending · {cn.sent} sent · {cn.failed} failed · delay {c.delay_seconds}s
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${statusColor}`}>
                      {c.status}
                    </span>
                    {(c.status === "idle" || c.status === "completed" || c.status === "paused") && (
                      <Button size="sm" onClick={() => (c.status === "paused" ? setStatus(c.id, "running") : start(c))}>
                        <Play className="h-3.5 w-3.5 mr-1" /> {c.status === "paused" ? "Resume" : "Start"}
                      </Button>
                    )}
                    {c.status === "running" && (
                      <Button size="sm" variant="secondary" onClick={() => setStatus(c.id, "paused")}>
                        <Pause className="h-3.5 w-3.5 mr-1" /> Pause
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => reset(c.id)}>
                      <Square className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(c.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                {isOpen && <CampaignDetail campaignId={c.id} />}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function CampaignDetail({ campaignId }: { campaignId: string }) {
  const [cSmtps, setCSmtps] = useState<{ id: string; name: string; is_active: boolean }[]>([]);
  const [cTpls, setCTpls] = useState<{ id: string; name: string }[]>([]);
  const [allSmtps, setAllSmtps] = useState<{ id: string; name: string; is_active: boolean }[]>([]);
  const [allTpls, setAllTpls] = useState<{ id: string; name: string }[]>([]);
  const [text, setText] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [pickedSmtps, setPickedSmtps] = useState<string[]>([]);
  const [pickedTpls, setPickedTpls] = useState<string[]>([]);

  const load = async () => {
    const [s, t, allS, allT] = await Promise.all([
      supabase
        .from("campaign_smtps")
        .select("smtp_id,smtp_accounts(id,name,is_active)")
        .eq("campaign_id", campaignId)
        .order("rotation_order"),
      supabase
        .from("campaign_templates")
        .select("template_id,email_templates(id,name)")
        .eq("campaign_id", campaignId)
        .order("rotation_order"),
      supabase.from("smtp_accounts").select("id,name,is_active").order("rotation_order"),
      supabase.from("email_templates").select("id,name").order("created_at"),
    ]);
    const csm = ((s.data as any[]) ?? []).map((r) => r.smtp_accounts).filter(Boolean);
    const ctp = ((t.data as any[]) ?? []).map((r) => r.email_templates).filter(Boolean);
    setCSmtps(csm);
    setCTpls(ctp);
    setAllSmtps((allS.data as any) ?? []);
    setAllTpls((allT.data as any) ?? []);
    setPickedSmtps(csm.map((x: any) => x.id));
    setPickedTpls(ctp.map((x: any) => x.id));
  };

  useEffect(() => {
    load();
  }, [campaignId]);

  const addRecipients = async () => {
    const { valid, invalid } = parseEmailList(text);
    if (valid.length === 0) return toast.error("No valid emails");
    const { data: maxRow } = await supabase
      .from("recipients")
      .select("position")
      .eq("campaign_id", campaignId)
      .order("position", { ascending: false })
      .limit(1);
    let pos = (maxRow?.[0]?.position ?? -1) + 1;
    const rows = valid.map((email) => ({ campaign_id: campaignId, email, position: pos++ }));
    for (let i = 0; i < rows.length; i += 500) {
      await supabase.from("recipients").insert(rows.slice(i, i + 500));
    }
    toast.success(`Added ${valid.length}${invalid.length ? `, ${invalid.length} invalid skipped` : ""}`);
    setText("");
  };

  const toggle = (arr: string[], set: (v: string[]) => void, id: string) =>
    set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  const saveSelection = async () => {
    if (pickedSmtps.length === 0) return toast.error("Pick at least one SMTP");
    if (pickedTpls.length === 0) return toast.error("Pick at least one template");
    await supabase.from("campaign_smtps").delete().eq("campaign_id", campaignId);
    await supabase.from("campaign_templates").delete().eq("campaign_id", campaignId);
    await supabase.from("campaign_smtps").insert(
      pickedSmtps.map((id, i) => ({ campaign_id: campaignId, smtp_id: id, rotation_order: i }))
    );
    await supabase.from("campaign_templates").insert(
      pickedTpls.map((id, i) => ({ campaign_id: campaignId, template_id: id, rotation_order: i }))
    );
    toast.success("Campaign content updated");
    setEditOpen(false);
    load();
  };

  return (
    <div className="border-t border-border p-4 space-y-4 bg-muted/20">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase text-muted-foreground">Content</div>
        <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
          <Pencil className="h-3.5 w-3.5 mr-1" /> Edit selection
        </Button>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">SMTPs</div>
          <div className="text-sm">
            {cSmtps.length === 0 ? (
              <span className="text-muted-foreground">none</span>
            ) : (
              cSmtps.map((s, i) => (
                <span key={i} className={`inline-block mr-2 ${s.is_active ? "" : "text-muted-foreground"}`}>
                  {s.name}
                </span>
              ))
            )}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Templates</div>
          <div className="text-sm">
            {cTpls.length === 0 ? (
              <span className="text-muted-foreground">none</span>
            ) : (
              cTpls.map((t, i) => (
                <span key={i} className="inline-block mr-2">{t.name}</span>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-2">
          <Users className="h-3 w-3" /> Add more recipients
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste more emails…"
          className="min-h-[80px] font-mono text-xs"
        />
        <Button size="sm" onClick={addRecipients} disabled={!text.trim()}>
          Add to Campaign
        </Button>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Campaign Content</DialogTitle>
            <DialogDescription>Change which SMTPs and templates this campaign uses.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>SMTP Accounts ({pickedSmtps.length} selected)</Label>
              <div className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border">
                {allSmtps.length === 0 && (
                  <div className="p-3 text-sm text-muted-foreground">No SMTPs configured.</div>
                )}
                {allSmtps.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 p-2.5 text-sm cursor-pointer hover:bg-muted/40">
                    <Checkbox
                      checked={pickedSmtps.includes(s.id)}
                      onCheckedChange={() => toggle(pickedSmtps, setPickedSmtps, s.id)}
                    />
                    <span className="flex-1">{s.name}</span>
                    <span className={`text-xs ${s.is_active ? "text-success" : "text-muted-foreground"}`}>
                      {s.is_active ? "active" : "inactive"}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Templates ({pickedTpls.length} selected)</Label>
              <div className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border">
                {allTpls.length === 0 && (
                  <div className="p-3 text-sm text-muted-foreground">No templates yet.</div>
                )}
                {allTpls.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 p-2.5 text-sm cursor-pointer hover:bg-muted/40">
                    <Checkbox
                      checked={pickedTpls.includes(t.id)}
                      onCheckedChange={() => toggle(pickedTpls, setPickedTpls, t.id)}
                    />
                    <span className="flex-1">{t.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveSelection}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

