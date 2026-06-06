import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { FileText, Plus, Trash2, Pencil, Eye, Code } from "lucide-react";
import { toast } from "sonner";

interface Tpl {
  id: string;
  name: string;
  subject: string;
  body: string;
}

const EMPTY = { name: "", subject: "", body: "" };

export function TemplateManager() {
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [view, setView] = useState<"edit" | "preview">("edit");

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

  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY);
    setView("edit");
    setOpen(true);
  };

  const openEdit = (t: Tpl) => {
    setEditingId(t.id);
    setForm({ name: t.name, subject: t.subject, body: t.body });
    setView("edit");
    setOpen(true);
  };

  const save = async () => {
    if (!form.name || !form.subject || !form.body) {
      toast.error("All fields required");
      return;
    }
    if (editingId) {
      const { error } = await supabase
        .from("email_templates")
        .update(form)
        .eq("id", editingId);
      if (error) return toast.error(error.message);
      toast.success("Template updated");
    } else {
      const { error } = await supabase.from("email_templates").insert(form);
      if (error) return toast.error(error.message);
      toast.success("Template added");
    }
    setOpen(false);
    setForm(EMPTY);
    setEditingId(null);
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this template?")) return;
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
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-2" /> Add Template
        </Button>
      </div>

      {tpls.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm border-2 border-dashed border-border rounded-lg">
          No templates yet.
        </div>
      ) : (
        <div className="grid gap-2">
          {tpls.map((t) => (
            <div key={t.id} className="flex items-start justify-between p-3 rounded-lg border border-border gap-2">
              <button
                onClick={() => openEdit(t)}
                className="min-w-0 flex-1 text-left hover:bg-muted/40 -m-1 p-1 rounded"
              >
                <div className="font-medium truncate">{t.name}</div>
                <div className="text-sm text-muted-foreground truncate">{t.subject}</div>
              </button>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button size="sm" variant="ghost" onClick={() => openEdit(t)} title="View / Edit">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(t.id)} title="Delete">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Template" : "New Template"}</DialogTitle>
            <DialogDescription>
              {editingId ? "View the full email and make changes." : "Create a new email template."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-1 mb-3">
            <Button
              size="sm"
              variant={view === "edit" ? "default" : "outline"}
              onClick={() => setView("edit")}
            >
              <Code className="h-4 w-4 mr-1" /> Edit
            </Button>
            <Button
              size="sm"
              variant={view === "preview" ? "default" : "outline"}
              onClick={() => setView("preview")}
            >
              <Eye className="h-4 w-4 mr-1" /> Preview
            </Button>
          </div>

          {view === "edit" ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Welcome v1"
                />
              </div>
              <div className="space-y-1">
                <Label>Subject</Label>
                <Input
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>HTML Body</Label>
                <Textarea
                  className="font-mono text-xs min-h-[360px]"
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  placeholder="<h1>Hello</h1><p>...</p>"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Subject:</span>{" "}
                <span className="font-medium">{form.subject || "(empty)"}</span>
              </div>
              <iframe
                title="preview"
                className="w-full min-h-[480px] rounded-md border border-border bg-white"
                sandbox=""
                srcDoc={form.body || "<p style='font-family:sans-serif;color:#888;padding:24px'>Empty body</p>"}
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>{editingId ? "Save Changes" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
