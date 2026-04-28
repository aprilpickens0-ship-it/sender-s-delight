import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { startEngine, requestStop, isEngineRunning } from "@/lib/sending-engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, Pause, Square, Send } from "lucide-react";
import { toast } from "sonner";

interface State {
  status: "idle" | "running" | "paused" | "completed";
  delay_seconds: number;
  template_strategy: "sequential" | "random";
}

export function SendingControl() {
  const [state, setState] = useState<State | null>(null);
  const [delay, setDelay] = useState("5");
  const [strategy, setStrategy] = useState<"sequential" | "random">("sequential");

  const load = async () => {
    const { data } = await supabase.from("campaign_state").select("*").eq("id", 1).single();
    if (data) {
      setState(data as State);
      setDelay(String(data.delay_seconds));
      setStrategy((data.template_strategy as "sequential" | "random") ?? "sequential");
    }
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("state-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "campaign_state" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  // Resume engine if state is "running" but engine isn't (page reload case)
  useEffect(() => {
    if (state?.status === "running" && !isEngineRunning()) {
      startEngine();
    }
  }, [state?.status]);

  const updateConfig = async () => {
    await supabase
      .from("campaign_state")
      .update({
        delay_seconds: parseInt(delay, 10) || 0,
        template_strategy: strategy,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    toast.success("Settings saved");
  };

  const start = async () => {
    // Preflight: ensure smtp + tpl + recipients exist
    const [{ count: smtpCount }, { count: tplCount }, { count: pendingCount }] = await Promise.all([
      supabase.from("smtp_accounts").select("*", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("email_templates").select("*", { count: "exact", head: true }),
      supabase.from("recipients").select("*", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    if (!smtpCount) return toast.error("No active SMTPs. Test at least one SMTP first.");
    if (!tplCount) return toast.error("Add at least one template");
    if (!pendingCount) return toast.error("No pending recipients in the queue");

    await supabase
      .from("campaign_state")
      .update({
        status: "running",
        delay_seconds: parseInt(delay, 10) || 0,
        template_strategy: strategy,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    startEngine();
    toast.success("Sending started");
  };

  const pause = async () => {
    requestStop();
    await supabase
      .from("campaign_state")
      .update({ status: "paused", updated_at: new Date().toISOString() })
      .eq("id", 1);
    toast.info("Paused — finishing current email");
  };

  const resume = async () => {
    await supabase
      .from("campaign_state")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", 1);
    startEngine();
    toast.success("Resumed");
  };

  const reset = async () => {
    if (!confirm("Reset campaign? This won't delete recipients but will reset rotation indices.")) return;
    requestStop();
    await supabase
      .from("campaign_state")
      .update({
        status: "idle",
        current_position: 0,
        smtp_rotation_index: 0,
        template_rotation_index: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
  };

  const status = state?.status ?? "idle";
  const statusColor = {
    idle: "text-muted-foreground",
    running: "text-success",
    paused: "text-warning",
    completed: "text-primary",
  }[status];

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Send className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Sending Control</h2>
            <p className={`text-sm font-medium ${statusColor}`}>Status: {status.toUpperCase()}</p>
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <div className="space-y-1">
          <Label>Delay between emails (seconds)</Label>
          <Input type="number" min={0} value={delay} onChange={(e) => setDelay(e.target.value)} onBlur={updateConfig} />
        </div>
        <div className="space-y-1">
          <Label>Template rotation</Label>
          <Select
            value={strategy}
            onValueChange={(v: "sequential" | "random") => {
              setStrategy(v);
              setTimeout(updateConfig, 0);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sequential">Sequential</SelectItem>
              <SelectItem value="random">Random</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(status === "idle" || status === "completed") && (
          <Button onClick={start} className="flex-1 sm:flex-none">
            <Play className="h-4 w-4 mr-2" /> Start Sending
          </Button>
        )}
        {status === "running" && (
          <Button onClick={pause} variant="secondary" className="flex-1 sm:flex-none">
            <Pause className="h-4 w-4 mr-2" /> Pause
          </Button>
        )}
        {status === "paused" && (
          <Button onClick={resume} className="flex-1 sm:flex-none">
            <Play className="h-4 w-4 mr-2" /> Resume
          </Button>
        )}
        {status !== "idle" && (
          <Button onClick={reset} variant="outline">
            <Square className="h-4 w-4 mr-2" /> Reset
          </Button>
        )}
      </div>

      {status === "running" && (
        <p className="mt-4 text-xs text-muted-foreground">
          Campaign marked as <strong>running</strong>. The external Node worker (see <code>/worker</code> folder) must be running on your VPS to actually send emails. Closing this tab does NOT stop sending — the worker continues independently.
        </p>
      )}
    </Card>
  );
}
