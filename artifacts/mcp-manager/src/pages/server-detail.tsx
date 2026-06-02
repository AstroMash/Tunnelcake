import { useState, useEffect } from "react";
import {
  useGetServer, useGetServerStatus, useGetServerLogs, useStartServer, useStopServer,
  useUpdateServer, useGetTunnelConfig, useSetTunnelConfig, useGetNgrokConfig, useSetNgrokConfig,
  useListEnvVars, useDeleteEnvVar, useDeleteServer,
  getGetServerQueryKey, getGetTunnelConfigQueryKey, getGetNgrokConfigQueryKey, getListEnvVarsQueryKey,
  getListServersQueryKey, getGetSummaryQueryKey, getGetServerStatusQueryKey, getGetServerLogsQueryKey
} from "@workspace/api-client-react";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "./dashboard";
import { Button } from "@/components/ui/button";
import { Play, Square, Terminal as TerminalIcon, Copy, Trash, Edit, Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { EnvVarDialog } from "./environment";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";

export function ServerDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: server, isLoading } = useGetServer(id, {
    query: { enabled: !!id, queryKey: getGetServerQueryKey(id) }
  });

  const { data: status } = useGetServerStatus(id, {
    query: { enabled: !!id, refetchInterval: 2000, queryKey: getGetServerStatusQueryKey(id) }
  });

  const isRunning = status?.state === "running";
  const isStarting = status?.state === "starting";

  const { data: logs } = useGetServerLogs(id, {
    query: { enabled: !!id && (isRunning || isStarting), refetchInterval: 2000, queryKey: getGetServerLogsQueryKey(id) }
  });

  const startMutation = useStartServer();
  const stopMutation = useStopServer();
  const updateMutation = useUpdateServer();
  const deleteMutation = useDeleteServer();

  if (isLoading) {
    return <Skeleton className="h-64 w-full bg-secondary" />;
  }

  if (!server) {
    return <div>Server not found</div>;
  }

  const handleConnectionModeChange = (mode: "none" | "tunnel" | "ngrok") => {
    updateMutation.mutate({ id, data: { connectionMode: mode } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetServerQueryKey(id) });
        toast({ title: "Connection mode updated" });
      }
    });
  };

  const handleDelete = () => {
    deleteMutation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListServersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
        toast({ title: "Server deleted" });
        setLocation("/");
      }
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between border-b border-border pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-4">
            {server.name}
            <StatusBadge state={status?.state || server.state} />
          </h1>
          <p className="text-sm font-mono text-muted-foreground mt-2">
            {server.command} {server.args?.join(" ")}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-2 bg-secondary p-1 rounded-md">
            <Button
              variant="default"
              size="sm"
              disabled={isRunning || isStarting || startMutation.isPending}
              onClick={() => startMutation.mutate({ id })}
              className="bg-green-500/20 text-green-400 hover:bg-green-500/30 hover:text-green-300 border-none"
            >
              <Play className="w-4 h-4 mr-2" />
              Start
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!isRunning || stopMutation.isPending}
              onClick={() => stopMutation.mutate({ id })}
            >
              <Square className="w-4 h-4 mr-2" />
              Stop
            </Button>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                <Trash className="w-4 h-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete server?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete the server and its environment variables.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Connection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Mode</Label>
                <Select value={server.connectionMode} onValueChange={handleConnectionModeChange} disabled={updateMutation.isPending || isRunning}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (Local only)</SelectItem>
                    <SelectItem value="tunnel">Tunnel (OpenAI Secure MCP Tunnel)</SelectItem>
                    <SelectItem value="ngrok">ngrok (Public SSE)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {server.connectionMode === "tunnel" && "Tunnel = OpenAI Secure MCP Tunnel, private, recommended, server NOT exposed publicly. Needs a Tunnel ID and an OpenAI runtime API key."}
                  {server.connectionMode === "ngrok" && "ngrok = exposes a public HTTPS SSE endpoint protected by a bearer token. Needs an ngrok auth token."}
                  {server.connectionMode === "none" && "None = Runs locally, not accessible from outside."}
                </p>
              </div>

              {server.connectionMode === "tunnel" && <TunnelConfigForm serverId={id} />}
              {server.connectionMode === "ngrok" && <NgrokConfigForm serverId={id} />}
            </CardContent>
          </Card>

          {isRunning && status?.connectorUrl && (
            <Card className="border-primary/50 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-sm font-medium uppercase tracking-wider text-primary">Connector URL</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-primary/80">Paste this URL into ChatGPT &gt; Settings &gt; Connectors.</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={status.connectorUrl} className="font-mono text-xs bg-background" />
                    <CopyButton text={status.connectorUrl} />
                  </div>
                </div>
                
                {server.connectionMode === "ngrok" && status.bearerToken && (
                  <div className="space-y-2">
                    <Label className="text-primary/80">Use this as the connector's bearer/authentication token.</Label>
                    <div className="flex gap-2">
                      <Input readOnly value={status.bearerToken} type="password" className="font-mono text-xs bg-background" />
                      <CopyButton text={status.bearerToken} />
                    </div>
                  </div>
                )}
                
                {server.connectionMode === "tunnel" && status.publicUrl && (
                  <div className="pt-2">
                    <a href={status.publicUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center">
                      Open UI Dashboard &rarr;
                    </a>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {status?.lastError && status.state === "error" && (
            <Alert variant="destructive">
              <AlertTitle>Server Error</AlertTitle>
              <AlertDescription className="font-mono text-xs mt-2 break-all">
                {status.lastError}
              </AlertDescription>
            </Alert>
          )}

          <ServerEnvVars serverId={id} />
        </div>

        <div>
          <Card className="h-full flex flex-col">
            <CardHeader>
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Live Logs</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-[500px]">
              <div className="bg-[#0A0A0A] rounded-md border border-border p-4 h-full overflow-y-auto font-mono text-xs flex flex-col gap-1">
                {!logs || logs.lines.length === 0 ? (
                  <div className="text-muted-foreground italic">Waiting for logs...</div>
                ) : (
                  logs.lines.map((line, i) => (
                    <div key={i} className="flex gap-4">
                      <span className="text-gray-500 opacity-50 shrink-0">{new Date(line.timestamp).toLocaleTimeString()}</span>
                      <span className={`
                        ${line.stream === 'stderr' ? 'text-red-400' : ''}
                        ${line.stream === 'system' ? 'text-blue-400' : ''}
                        ${line.stream === 'stdout' ? 'text-gray-300' : ''}
                        break-all
                      `}>
                        {line.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function TunnelConfigForm({ serverId }: { serverId: number }) {
  const { data: config, isLoading } = useGetTunnelConfig(serverId, {
    query: { enabled: !!serverId, queryKey: getGetTunnelConfigQueryKey(serverId), retry: false }
  });
  const setConfig = useSetTunnelConfig();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [tunnelId, setTunnelId] = useState("");
  const [apiKey, setApiKey] = useState("");

  // Sync state when config loads
  useEffect(() => {
    if (config?.tunnelId) setTunnelId(config.tunnelId);
  }, [config?.tunnelId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setConfig.mutate({
      id: serverId,
      data: { tunnelId, ...(apiKey ? { apiKey } : {}) }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTunnelConfigQueryKey(serverId) });
        toast({ title: "Tunnel config saved" });
        setApiKey(""); // clear input after save
      }
    });
  };

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-4 border-t border-border">
      <div className="space-y-2">
        <Label>Tunnel ID</Label>
        <Input value={tunnelId} onChange={e => setTunnelId(e.target.value)} required placeholder="e.g. tun-..." />
      </div>
      <div className="space-y-2">
        <Label>OpenAI Runtime API Key {config?.hasApiKey && <span className="text-green-500 ml-2 text-xs">(Key saved)</span>}</Label>
        <Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={config?.hasApiKey ? "Leave blank to keep existing" : "sk-..."} required={!config?.hasApiKey} />
      </div>
      <Button type="submit" disabled={setConfig.isPending} size="sm">
        {setConfig.isPending ? "Saving..." : "Save Config"}
      </Button>
    </form>
  );
}

function NgrokConfigForm({ serverId }: { serverId: number }) {
  const { data: config, isLoading } = useGetNgrokConfig(serverId, {
    query: { enabled: !!serverId, queryKey: getGetNgrokConfigQueryKey(serverId), retry: false }
  });
  const setConfig = useSetNgrokConfig();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [authToken, setAuthToken] = useState("");
  const [domain, setDomain] = useState("");
  const [rotate, setRotate] = useState(false);

  useEffect(() => {
    if (config?.domain) setDomain(config.domain);
  }, [config?.domain]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setConfig.mutate({
      id: serverId,
      data: { 
        ...(authToken ? { authToken } : {}),
        ...(domain ? { domain } : {}),
        rotateBearerToken: rotate
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetNgrokConfigQueryKey(serverId) });
        toast({ title: "ngrok config saved" });
        setAuthToken("");
        setRotate(false);
      }
    });
  };

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-4 border-t border-border">
      <div className="space-y-2">
        <Label>ngrok Auth Token {config?.hasAuthToken && <span className="text-green-500 ml-2 text-xs">(Token saved)</span>}</Label>
        <Input type="password" value={authToken} onChange={e => setAuthToken(e.target.value)} placeholder={config?.hasAuthToken ? "Leave blank to keep existing" : "..."} required={!config?.hasAuthToken} />
      </div>
      <div className="space-y-2">
        <Label>Static Domain (optional)</Label>
        <Input value={domain} onChange={e => setDomain(e.target.value)} placeholder="e.g. my-app.ngrok-free.app" />
      </div>
      
      {config?.bearerToken && (
        <div className="space-y-2">
          <Label>Bearer Token (Secret)</Label>
          <div className="flex gap-2">
            <Input type="password" value={config.bearerToken} readOnly className="font-mono text-xs" />
            <CopyButton text={config.bearerToken} />
          </div>
          <div className="flex items-center space-x-2 pt-2">
            <Checkbox id="rotate" checked={rotate} onCheckedChange={(c) => setRotate(!!c)} />
            <Label htmlFor="rotate" className="text-xs font-normal">Rotate bearer token on save</Label>
          </div>
        </div>
      )}

      <Button type="submit" disabled={setConfig.isPending} size="sm">
        {setConfig.isPending ? "Saving..." : "Save Config"}
      </Button>
    </form>
  );
}

function ServerEnvVars({ serverId }: { serverId: number }) {
  const { data: envVars, isLoading } = useListEnvVars({ serverId }, {
    query: { enabled: !!serverId, queryKey: getListEnvVarsQueryKey({ serverId }) }
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteMutation = useDeleteEnvVar();

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  const serverVars = envVars?.filter(v => v.scope === "server") || [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between py-4">
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Server Environment</CardTitle>
        <EnvVarDialog serverId={serverId} />
      </CardHeader>
      <CardContent>
        {serverVars.length === 0 ? (
          <div className="text-center p-4 text-xs text-muted-foreground border border-dashed rounded-md">
            No server-specific variables.
          </div>
        ) : (
          <div className="space-y-2">
            {serverVars.map(variable => (
              <div key={variable.id} className="p-3 border rounded-md bg-secondary/30 flex justify-between items-center group">
                <div className="flex-1 overflow-hidden mr-4">
                  <div className="font-mono text-primary font-bold text-sm truncate">{variable.key}</div>
                  <div className="font-mono text-muted-foreground text-xs blur-sm hover:blur-none transition-all cursor-pointer truncate mt-1">
                    {variable.value}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <EnvVarDialog variable={variable} serverId={serverId} />
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => {
                      deleteMutation.mutate({ id: variable.id }, {
                        onSuccess: () => {
                          queryClient.invalidateQueries({ queryKey: getListEnvVarsQueryKey({ serverId }) });
                          toast({ title: "Variable deleted" });
                        }
                      });
                    }}
                    disabled={deleteMutation.isPending} 
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8"
                  >
                    <Trash className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  return (
    <Button variant="outline" size="icon" onClick={handleCopy} className="shrink-0">
      {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
    </Button>
  );
}
