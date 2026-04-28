import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseEmailList } from "@/lib/email-utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Upload, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

export function RecipientManager() {
  const [counts, setCounts] = useState({ pending: 0, sent: 0, failed: 0, total: 0 });
  const [text, setText] = useState("");

  const load = async () => {
    const { data } = await supabase.from("recipients").select("status");
    const arr = data ?? [];
    setCounts({
      total: arr.length,
      pending: arr.filter((r: any) => r.status === "pending").length,
      sent: arr.filter((r: any) => r.status === "sent").length,
      failed: arr.filter((r: any) => r.status === "failed").length,
    });
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("rcp-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "recipients" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const add = async () => {
    const { valid, invalid } = parseEmailList(text);
    if (valid.length === 0) {
      toast.error("No valid emails found");
      return;
    }
    // Get current max position
    const { data: maxRow } = await supabase
      .from("recipients")
      .select("position")
      .order("position", { ascending: false })
      .limit(1);
    let pos = (maxRow?.[0]?.position ?? -1) + 1;
    const rows = valid.map((email) => ({ email, position: pos++ }));
    // Insert in chunks of 500
    for (let i = 0; i < rows.length; i += 500) {
      await supabase.from("recipients").insert(rows.slice(i, i + 500));
    }
    toast.success(`Added ${valid.length} emails${invalid.length ? `, skipped ${invalid.length} invalid` : ""}`);
    setText("");
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const txt = await f.text();
    setText((prev) => (prev ? prev + "\n" : "") + txt);
    e.target.value = "";
  };

  const clearAll = async () => {
    if (!confirm("Delete ALL recipients and reset queue?")) return;
    await supabase.from("recipients").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("campaign_state").update({ current_position: 0, status: "idle" }).eq("id", 1);
    toast.success("Cleared");
  };

  const clearSent = async () => {
    await supabase.from("recipients").delete().eq("status", "sent");
    toast.success("Sent recipients cleared");
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-accent/15 text-accent flex items-center justify-center">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Recipients</h2>
            <p className="text-sm text-muted-foreground">
              {counts.total} total · {counts.pending} pending · {counts.sent} sent · {counts.failed} failed
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {counts.sent > 0 && (
            <Button variant="outline" size="sm" onClick={clearSent}>
              Clear Sent
            </Button>
          )}
          {counts.total > 0 && (
            <Button variant="outline" size="sm" onClick={clearAll}>
              <Trash2 className="h-4 w-4 mr-1" /> Clear All
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste emails (comma, semicolon, or newline separated)…"
          className="min-h-[140px] font-mono text-xs"
        />
        <div className="flex flex-wrap gap-2 items-center">
          <Button onClick={add} disabled={!text.trim()}>
            Add to Queue
          </Button>
          <label className="inline-flex">
            <input type="file" accept=".csv,.txt" onChange={onFile} className="hidden" />
            <Button variant="outline" asChild>
              <span className="cursor-pointer">
                <Upload className="h-4 w-4 mr-2" /> Upload CSV / TXT
              </span>
            </Button>
          </label>
          <span className="text-xs text-muted-foreground">Invalid emails are auto-removed</span>
        </div>
      </div>
    </Card>
  );
}
