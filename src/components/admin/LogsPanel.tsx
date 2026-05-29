import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ScrollText, Check, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Log {
  id: string;
  recipient_email: string;
  smtp_name: string | null;
  template_name: string | null;
  campaign_name: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

export function LogsPanel() {
  const [logs, setLogs] = useState<Log[]>([]);

  const load = async () => {
    const { data } = await supabase
      .from("send_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    setLogs((data as Log[]) ?? []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("logs-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "send_logs" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  return (
    <Card className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-10 rounded-lg bg-secondary text-secondary-foreground flex items-center justify-center">
          <ScrollText className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Activity Log</h2>
          <p className="text-sm text-muted-foreground">Last 200 events · live</p>
        </div>
      </div>
      <ScrollArea className="h-[400px] pr-3">
        {logs.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">No activity yet</div>
        ) : (
          <div className="space-y-1.5">
            {logs.map((l) => (
              <div
                key={l.id}
                className="flex items-start gap-3 p-2.5 rounded-md border border-border text-sm"
              >
                <div className={`mt-0.5 h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 ${l.status === "sent" ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive"}`}>
                  {l.status === "sent" ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{l.recipient_email}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {l.campaign_name && `[${l.campaign_name}] `}
                    {l.smtp_name && `via ${l.smtp_name}`}
                    {l.template_name && ` · ${l.template_name}`}
                    {l.error_message && ` · ${l.error_message}`}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground flex-shrink-0">
                  {formatDistanceToNow(new Date(l.created_at), { addSuffix: true })}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </Card>
  );
}
