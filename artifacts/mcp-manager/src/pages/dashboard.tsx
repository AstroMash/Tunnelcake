import { useState } from "react";
import { useGetSummary, useListServers, useGetEnvironmentInfo, useCreateServer, getListServersQueryKey, getGetSummaryQueryKey, getGetEnvironmentInfoQueryKey } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, AlertTriangle, Server as ServerIcon, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetSummary({
    query: { refetchInterval: 5000, queryKey: getGetSummaryQueryKey() }
  });
  
  const { data: servers, isLoading: isLoadingServers } = useListServers({
    query: { refetchInterval: 5000, queryKey: getListServersQueryKey() }
  });

  const { data: envInfo } = useGetEnvironmentInfo({
    query: { queryKey: getGetEnvironmentInfoQueryKey() }
  });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <CreateServerDialog />
      </div>

      {envInfo && !envInfo.boundToLocalhost && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Security Warning</AlertTitle>
          <AlertDescription>
            The MCP Manager is not bound to localhost. It may be accessible from the public internet.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Total Servers" value={summary?.totalServers} icon={ServerIcon} loading={isLoadingSummary} />
        <StatCard title="Running" value={summary?.runningServers} icon={Activity} className="text-green-500" loading={isLoadingSummary} />
        <StatCard title="Errored" value={summary?.erroredServers} icon={AlertTriangle} className="text-red-500" loading={isLoadingSummary} />
        <StatCard title="Global Env Vars" value={summary?.globalEnvVarCount} icon={Settings} loading={isLoadingSummary} />
      </div>

      <div>
        <h2 className="text-xl font-bold mb-4">Servers</h2>
        {isLoadingServers ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full bg-secondary" />
            <Skeleton className="h-24 w-full bg-secondary" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {servers?.length === 0 ? (
              <div className="text-center p-12 border border-dashed border-border rounded-lg text-muted-foreground">
                No servers configured.
              </div>
            ) : (
              servers?.map((server) => (
                <Link key={server.id} href={`/servers/${server.id}`}>
                  <Card className="hover:border-primary/50 cursor-pointer transition-colors group">
                    <CardContent className="p-6 flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="font-bold text-lg group-hover:text-primary transition-colors">{server.name}</span>
                        <span className="text-sm font-mono text-muted-foreground mt-1">
                          {server.command} {server.args?.join(" ")}
                        </span>
                      </div>
                      <div className="flex items-center space-x-4">
                        <div className="flex flex-col items-end">
                          <span className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Status</span>
                          <StatusBadge state={server.state} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CreateServerDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [connectionMode, setConnectionMode] = useState<"none" | "tunnel" | "ngrok">("none");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const createServer = useCreateServer();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !command) return;

    createServer.mutate({
      data: {
        name,
        command,
        args: args ? args.split(" ") : [],
        connectionMode
      }
    }, {
      onSuccess: (newServer) => {
        queryClient.invalidateQueries({ queryKey: getListServersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
        toast({ title: "Server created successfully" });
        setOpen(false);
        setLocation(`/servers/${newServer.id}`);
      },
      onError: () => {
        toast({ title: "Failed to create server", variant: "destructive" });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="font-mono text-xs">
          + New Server
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add New Server</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. My MCP Server" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="command">Command</Label>
            <Input id="command" value={command} onChange={e => setCommand(e.target.value)} placeholder="e.g. uvx" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="args">Args (space separated)</Label>
            <Input id="args" value={args} onChange={e => setArgs(e.target.value)} placeholder="e.g. mcp-pfsense" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mode">Connection Mode</Label>
            <Select value={connectionMode} onValueChange={(v: any) => setConnectionMode(v)}>
              <SelectTrigger id="mode">
                <SelectValue placeholder="Select mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (Local only)</SelectItem>
                <SelectItem value="tunnel">Tunnel (OpenAI Secure MCP Tunnel)</SelectItem>
                <SelectItem value="ngrok">ngrok (Public SSE)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={createServer.isPending || !name || !command}>
              {createServer.isPending ? "Creating..." : "Create Server"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ title, value, icon: Icon, className, loading }: any) {
  return (
    <Card className="bg-card">
      <CardContent className="p-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          {loading ? (
            <Skeleton className="h-8 w-16 mt-2 bg-secondary" />
          ) : (
            <p className="text-3xl font-bold mt-1">{value}</p>
          )}
        </div>
        <div className={`p-3 rounded-full bg-secondary ${className || "text-foreground"}`}>
          <Icon className="w-5 h-5" />
        </div>
      </CardContent>
    </Card>
  );
}

export function StatusBadge({ state }: { state: string }) {
  const colors: Record<string, string> = {
    running: "bg-green-500/20 text-green-400 border-green-500/30",
    stopped: "bg-gray-500/20 text-gray-400 border-gray-500/30",
    error: "bg-red-500/20 text-red-400 border-red-500/30",
    starting: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30 animate-pulse",
  };
  
  const dots: Record<string, string> = {
    running: "bg-green-400",
    stopped: "bg-gray-400",
    error: "bg-red-400",
    starting: "bg-yellow-400",
  };

  return (
    <div className={`px-2.5 py-0.5 rounded-full text-xs font-medium border flex items-center gap-2 ${colors[state] || colors.stopped}`}>
      <div className={`w-1.5 h-1.5 rounded-full ${dots[state] || dots.stopped}`} />
      {state.toUpperCase()}
    </div>
  );
}
