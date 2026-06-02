import { useState } from "react";
import { Link } from "wouter";
import { Copy, Check, Terminal, Shield, Zap, Server, Github, ArrowRight, Activity, Network } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  const [copied, setCopied] = useState(false);
  
  const copyCommand = async () => {
    try {
      if (!navigator.clipboard?.writeText) return;
      await navigator.clipboard.writeText("npx mcp-server-manager");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30 font-sans overflow-x-hidden">
      
      {/* Background Glow */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[120px]" />
      </div>

      <div className="relative z-10">
        
        {/* Nav */}
        <nav className="border-b border-border/50 bg-background/80 backdrop-blur-md sticky top-0 z-50">
          <div className="container mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2 font-mono font-bold tracking-tight text-lg text-primary">
              <Terminal className="w-5 h-5" />
              <span>mcp-manager</span>
            </div>
            <div>
              <a href="https://github.com/mcp-server-manager/mcp-server-manager" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2 text-sm font-medium">
                <Github className="w-4 h-4" />
                <span>GitHub</span>
              </a>
            </div>
          </div>
        </nav>

        {/* Hero Section */}
        <section className="pt-32 pb-24 px-6">
          <div className="container mx-auto max-w-4xl text-center flex flex-col items-center">
            
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary text-xs font-mono font-medium mb-8">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
              Local-first MCP Server Management
            </div>

            <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 leading-tight">
              Manage your MCP servers.<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400">Never leave local.</span>
            </h1>
            
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-12 font-medium">
              A desktop-class control panel for stdio MCP servers. Run locally, manage effortlessly, and securely expose them to ChatGPT via OpenAI Secure MCP Tunnel or ngrok SSE.
            </p>

            <div className="w-full max-w-md bg-card/80 backdrop-blur border border-border rounded-lg p-2 flex items-center gap-4 shadow-xl shadow-primary/5">
              <div className="flex items-center justify-center w-8 h-8 rounded bg-background border border-border">
                <Terminal className="w-4 h-4 text-primary" />
              </div>
              <code className="font-mono text-sm text-foreground flex-1 text-left">npx mcp-server-manager</code>
              <Button 
                variant="secondary" 
                size="sm" 
                className="gap-2 font-mono text-xs hover:bg-primary hover:text-primary-foreground transition-colors"
                onClick={copyCommand}
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            <div className="mt-12 flex items-center justify-center gap-6 text-sm text-muted-foreground font-mono">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-primary" /> Zero cloud backend
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-primary" /> Open source
              </div>
            </div>
          </div>
        </section>

        {/* The Problem / Solution */}
        <section className="py-24 px-6 border-t border-border/50 bg-secondary/20">
          <div className="container mx-auto max-w-5xl">
            <div className="grid md:grid-cols-3 gap-8">
              <div className="bg-card border border-border rounded-xl p-6">
                <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-6">
                  <Shield className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-3">Privacy First</h3>
                <p className="text-muted-foreground">Your API keys, environment variables, and execution context never leave your machine. No telemetry, no external databases.</p>
              </div>
              
              <div className="bg-card border border-border rounded-xl p-6 relative overflow-hidden">
                <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-6 relative z-10">
                  <Network className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-3 relative z-10">Secure Bridging</h3>
                <p className="text-muted-foreground relative z-10">Seamlessly expose local stdio servers via OpenAI Secure MCP Tunnel or ngrok SSE bridge to interact with cloud AI agents.</p>
              </div>

              <div className="bg-card border border-border rounded-xl p-6">
                <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-6">
                  <Activity className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold mb-3">Desktop Class</h3>
                <p className="text-muted-foreground">Real-time logs, process management, connection states, and environment variable configuration in a crisp, fast interface.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Connections Section */}
        <section className="py-32 px-6">
          <div className="container mx-auto max-w-5xl">
            <div className="flex flex-col md:flex-row items-center gap-16">
              <div className="flex-1">
                <h2 className="text-3xl md:text-4xl font-bold mb-6">Connect to the outside world, securely.</h2>
                <p className="text-lg text-muted-foreground mb-8">
                  stdIO servers are great for local testing, but deploying them can be a headache. MCP Server Manager includes built-in tunneling so your cloud LLMs can securely access your local tools.
                </p>
                
                <div className="space-y-6">
                  <div className="flex gap-4">
                    <div className="mt-1 w-8 h-8 rounded bg-secondary border border-border flex items-center justify-center shrink-0">
                      <Zap className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-bold text-lg">OpenAI Secure MCP Tunnel</h4>
                      <p className="text-muted-foreground text-sm mt-1">First-class support for OpenAI's official secure tunnel implementation. Authenticate and expose endpoints without exposing your machine.</p>
                    </div>
                  </div>
                  
                  <div className="flex gap-4">
                    <div className="mt-1 w-8 h-8 rounded bg-secondary border border-border flex items-center justify-center shrink-0">
                      <Server className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-bold text-lg">ngrok SSE</h4>
                      <p className="text-muted-foreground text-sm mt-1">Convert your stdio MCP server into an HTTP Server-Sent Events stream, securely bridged to the internet via ngrok.</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="flex-1 w-full bg-card border border-border rounded-xl p-6 shadow-2xl relative">
                {/* Abstract UI representation */}
                <div className="absolute top-0 right-8 w-px h-full bg-gradient-to-b from-primary/0 via-primary/50 to-primary/0"></div>
                
                <div className="space-y-4 font-mono text-sm">
                  <div className="flex items-center justify-between p-3 border border-border rounded bg-background">
                    <div className="flex items-center gap-3">
                      <span className="w-2 h-2 rounded-full bg-green-500"></span>
                      <span>local-postgres-mcp</span>
                    </div>
                    <span className="text-xs text-muted-foreground">stdio</span>
                  </div>
                  
                  <div className="flex justify-center py-2">
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                  
                  <div className="flex items-center justify-between p-3 border border-primary/30 rounded bg-primary/5">
                    <div className="flex items-center gap-3">
                      <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
                      <span className="text-primary">OpenAI Secure Tunnel</span>
                    </div>
                    <span className="text-xs text-primary/70 font-bold">ACTIVE</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-32 px-6 border-t border-border bg-card/50">
          <div className="container mx-auto max-w-3xl text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">Take control of your local AI tools.</h2>
            <p className="text-muted-foreground mb-10 text-lg">
              No signups. No cloud dependencies. Just run the command and start managing.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button asChild size="lg" className="gap-2 w-full sm:w-auto font-medium text-base h-12 px-8">
                <a href="https://github.com/mcp-server-manager/mcp-server-manager" target="_blank" rel="noopener noreferrer">
                  <Github className="w-5 h-5" />
                  View on GitHub
                </a>
              </Button>
              <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto font-mono text-base h-12 px-8 border-primary/20 hover:bg-primary/10 hover:text-primary transition-colors" onClick={copyCommand}>
                {copied ? <Check className="w-5 h-5" /> : <Terminal className="w-5 h-5" />}
                {copied ? "Copied" : "npx mcp-server-manager"}
              </Button>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-border py-12 px-6 bg-background">
          <div className="container mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2 font-mono">
              <Terminal className="w-4 h-4" />
              mcp-manager
            </div>
            <p>Built for developers, by developers.</p>
          </div>
        </footer>

      </div>
    </div>
  );
}