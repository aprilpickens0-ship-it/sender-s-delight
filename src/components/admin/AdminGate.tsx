import { useEffect, useState } from "react";
import { ADMIN_PASSWORD, isAdminAuthed, setAdminAuthed } from "@/lib/admin-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Lock } from "lucide-react";
import { toast } from "sonner";

export function AdminGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");

  useEffect(() => {
    setAuthed(isAdminAuthed());
    setReady(true);
  }, []);

  if (!ready) return null;

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="p-8 w-full max-w-md space-y-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Lock className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold">Admin Access</h1>
            <p className="text-sm text-muted-foreground">
              Enter the admin password to access the email console.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (pw === ADMIN_PASSWORD) {
                setAdminAuthed(true);
                setAuthed(true);
                toast.success("Welcome");
              } else {
                toast.error("Incorrect password");
              }
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="pw">Password</Label>
              <Input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            </div>
            <Button type="submit" className="w-full">Unlock</Button>
            <p className="text-xs text-muted-foreground text-center">
              Default password: <code className="font-mono">admin123</code> — change it in <code className="font-mono">src/lib/admin-auth.ts</code>
            </p>
          </form>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
