import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AdminGate } from "@/components/admin/AdminGate";
import { Dashboard } from "@/components/admin/Dashboard";
import { SmtpManager } from "@/components/admin/SmtpManager";
import { TemplateManager } from "@/components/admin/TemplateManager";
import { CampaignManager } from "@/components/admin/CampaignManager";
import { LogsPanel } from "@/components/admin/LogsPanel";
import { setAdminAuthed } from "@/lib/admin-auth";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { LayoutDashboard, Server, FileText, Send, ScrollText, LogOut, Mail } from "lucide-react";

export const Route = createFileRoute("/")({
  component: AdminPage,
});

const sections = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "smtp", label: "SMTP Accounts", icon: Server },
  { id: "templates", label: "Templates", icon: FileText },
  { id: "campaigns", label: "Campaigns", icon: Send },
  { id: "logs", label: "Activity Log", icon: ScrollText },
] as const;

function AdminPage() {
  const [active, setActive] = useState<(typeof sections)[number]["id"]>("dashboard");

  return (
    <AdminGate>
      <Toaster richColors position="top-right" />
      <div className="min-h-screen flex bg-background">
        <aside className="w-64 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border">
          <div className="p-6 border-b border-sidebar-border">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <h1 className="font-bold leading-tight">MailRotor</h1>
                <p className="text-xs text-sidebar-foreground/60">Admin Console</p>
              </div>
            </div>
          </div>
          <nav className="flex-1 p-3 space-y-1">
            {sections.map((s) => {
              const Icon = s.icon;
              const isActive = active === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setActive(s.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {s.label}
                </button>
              );
            })}
          </nav>
          <div className="p-3 border-t border-sidebar-border">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={() => {
                setAdminAuthed(false);
                window.location.reload();
              }}
            >
              <LogOut className="h-4 w-4 mr-2" /> Lock console
            </Button>
          </div>
        </aside>

        <main className="flex-1 overflow-auto">
          <div className="max-w-6xl mx-auto p-6 lg:p-8 space-y-6">
            {active === "dashboard" && (
              <>
                <Dashboard />
                <LogsPanel />
              </>
            )}
            {active === "smtp" && <SmtpManager />}
            {active === "templates" && <TemplateManager />}
            {active === "campaigns" && <CampaignManager />}
            {active === "logs" && <LogsPanel />}
          </div>
        </main>
      </div>
    </AdminGate>
  );
}
