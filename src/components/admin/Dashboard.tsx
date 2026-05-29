import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Activity, Inbox, Send, AlertTriangle, Server, Zap } from "lucide-react";

interface Stats {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  smtpActive: number;
  smtpInactive: number;
  campaignsRunning: number;
  campaignsTotal: number;
}

export function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    total: 0,
    sent: 0,
    failed: 0,
    pending: 0,
    smtpActive: 0,
    smtpInactive: 0,
    campaignsRunning: 0,
    campaignsTotal: 0,
  });

  const load = async () => {
    const [r, s, c] = await Promise.all([
      supabase.from("recipients").select("status"),
      supabase.from("smtp_accounts").select("is_active"),
      supabase.from("campaigns").select("status"),
    ]);
    const recs = r.data ?? [];
    const smtps = s.data ?? [];
    const cams = c.data ?? [];
    setStats({
      total: recs.length,
      sent: recs.filter((x: any) => x.status === "sent").length,
      failed: recs.filter((x: any) => x.status === "failed").length,
      pending: recs.filter((x: any) => x.status === "pending").length,
      smtpActive: smtps.filter((x: any) => x.is_active).length,
      smtpInactive: smtps.filter((x: any) => !x.is_active).length,
      campaignsRunning: cams.filter((x: any) => x.status === "running").length,
      campaignsTotal: cams.length,
    });
  };

  useEffect(() => {
    load();
    const tables = ["recipients", "smtp_accounts", "campaigns", "send_logs"];
    const channels = tables.map((t) =>
      supabase
        .channel(`dash-${t}`)
        .on("postgres_changes", { event: "*", schema: "public", table: t }, load)
        .subscribe()
    );
    return () => {
      channels.forEach((c) => supabase.removeChannel(c));
    };
  }, []);

  const tiles = [
    { label: "Recipients", value: stats.total, icon: Inbox, color: "text-foreground", bg: "bg-secondary" },
    { label: "Sent", value: stats.sent, icon: Send, color: "text-success", bg: "bg-success/15" },
    { label: "Pending", value: stats.pending, icon: Activity, color: "text-primary", bg: "bg-primary/15" },
    { label: "Failed", value: stats.failed, icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/15" },
    { label: "Active SMTPs", value: stats.smtpActive, icon: Server, color: "text-success", bg: "bg-success/15" },
    { label: "Inactive SMTPs", value: stats.smtpInactive, icon: Server, color: "text-destructive", bg: "bg-destructive/15" },
  ];

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Dashboard</h2>
            <p className="text-sm text-muted-foreground">Real-time campaign overview</p>
          </div>
        </div>
        <div className="px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide bg-primary/15 text-primary">
          {stats.campaignsRunning} running / {stats.campaignsTotal} campaigns
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <div key={t.label} className="rounded-lg border border-border p-4">
              <div className={`h-8 w-8 rounded-md ${t.bg} ${t.color} flex items-center justify-center mb-3`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="text-2xl font-bold tabular-nums">{t.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{t.label}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
