import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Tpl {
  id: string;
  name: string;
  subject: string;
  body: string;
}

export function TemplateManager() {
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", subject: "", body: "" });

  const load = async () => {
    const { data } = await supabase.from("email_templates").select("*").order("created_at");
    setTpls((data as Tpl[]) ?? []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("tpl-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "email_templates" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const add = async () => {
    if (!form.name || !form.subject || !form.body) {
      toast.error("All fields required");
      return;
    }
    const { error } = await supabase.from("email_templates").insert(form);
    if (error) toast.error(error.message);
    else {
      toast.success("Template added");
      setOpen(false);
      setForm({ name: "", subject: "", body: "" });
    }
  };

  const remove = async (id: string) => {
    await supabase.from("email_templates").delete().eq("id", id);
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-accent/15 text-accent flex items-center justify-center">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Email Templates</h2>
            <p className="text-sm text-muted-foreground">{tpls.length} templates · auto-rotated</p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" /> Add Template
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>New Template</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Welcome v1" />
              </div>
              <div className="space-y-1">
                <Label>Subject</Label>
                <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>HTML Body</Label>
                <Textarea
                  className="font-mono text-xs min-h-[220px]"
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  placeholder="<h1>Hello</h1><p>...</p>"
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={add}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {tpls.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm border-2 border-dashed border-border rounded-lg">
          No templates yet.
        </div>
      ) : (
        <div className="grid gap-2">
          {tpls.map((t) => (
            <div key={t.id} className="flex items-start justify-between p-3 rounded-lg border border-border">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{t.name}</div>
                <div className="text-sm text-muted-foreground truncate">{t.subject}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => remove(t.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
