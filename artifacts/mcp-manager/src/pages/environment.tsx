import { useState } from "react";
import { useListEnvVars, useCreateEnvVar, useUpdateEnvVar, useDeleteEnvVar, getListEnvVarsQueryKey, getGetSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Trash, Edit } from "lucide-react";

export function Environment() {
  const { data: envVars, isLoading } = useListEnvVars();

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Global Environment</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Global variables are injected into every server's process environment.
          </p>
        </div>
        <EnvVarDialog />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Variables</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-32 w-full bg-secondary" />
          ) : (
            <div className="space-y-4">
              {envVars?.filter(v => v.scope === "global").length === 0 ? (
                <div className="text-center p-8 text-muted-foreground border border-dashed rounded-md">
                  No global environment variables.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {envVars?.filter(v => v.scope === "global").map(variable => (
                    <EnvVarItem key={variable.id} variable={variable} />
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EnvVarItem({ variable }: { variable: any }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteMutation = useDeleteEnvVar();

  const handleDelete = () => {
    deleteMutation.mutate({ id: variable.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEnvVarsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
        toast({ title: "Variable deleted" });
      }
    });
  };

  return (
    <div className="p-4 border rounded-md bg-secondary/50 flex justify-between items-center group">
      <div className="flex-1 overflow-hidden mr-4">
        <div className="font-mono text-primary font-bold truncate">{variable.key}</div>
        <div className="font-mono text-muted-foreground text-sm blur-sm hover:blur-none transition-all cursor-pointer truncate mt-1">
          {variable.value}
        </div>
      </div>
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <EnvVarDialog variable={variable} />
        <Button variant="ghost" size="icon" onClick={handleDelete} disabled={deleteMutation.isPending} className="text-destructive hover:text-destructive hover:bg-destructive/10">
          <Trash className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function EnvVarDialog({ variable, serverId = null }: { variable?: any, serverId?: number | null }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(variable?.key || "");
  const [value, setValue] = useState(variable?.value || "");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const createMutation = useCreateEnvVar();
  const updateMutation = useUpdateEnvVar();

  const isEditing = !!variable;
  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!key || !value) return;

    if (isEditing) {
      updateMutation.mutate({
        id: variable.id,
        data: { value }
      }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEnvVarsQueryKey(serverId ? { serverId } : undefined) });
          if (!serverId) queryClient.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
          toast({ title: "Variable updated" });
          setOpen(false);
        }
      });
    } else {
      createMutation.mutate({
        data: { serverId, key, value }
      }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEnvVarsQueryKey(serverId ? { serverId } : undefined) });
          if (!serverId) queryClient.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
          toast({ title: "Variable created" });
          setOpen(false);
          setKey("");
          setValue("");
        }
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEditing ? (
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
            <Edit className="w-4 h-4" />
          </Button>
        ) : (
          <Button variant="outline" className="font-mono text-xs">
            + Add Variable
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Variable" : "Add Variable"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="key">Key</Label>
            <Input id="key" value={key} onChange={e => setKey(e.target.value)} disabled={isEditing} placeholder="e.g. API_KEY" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="value">Value</Label>
            <Input id="value" value={value} onChange={e => setValue(e.target.value)} type="password" placeholder="e.g. sk-..." required />
          </div>
          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={isPending || !key || !value}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { EnvVarDialog };
