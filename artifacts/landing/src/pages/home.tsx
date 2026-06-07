import { useState } from "react";
import {
  Copy,
  Check,
  Terminal,
  Shield,
  Lock,
  MonitorDot,
  Code2,
  Github,
  ArrowRight,
  Server,
  Network,
  ScrollText,
  Settings,
  Database,
  FolderTree,
  Brain,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TunnelMark } from "@/components/tunnel-mark";

const REPO_URL = "https://github.com/AstroMash/Tunnelcake";
const heroBg = `${import.meta.env.BASE_URL}hero-bg.png`;

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "Docs", href: `${REPO_URL}#readme` },
  { label: "Security", href: "#security" },
  { label: "GitHub", href: REPO_URL },
];

const servers = [
  { name: "local-postgres", icon: Database, kind: "stdio", status: "Running" },
  { name: "filesystems", icon: FolderTree, kind: "stdio", status: "Running" },
  { name: "github", icon: Github, kind: "stdio", status: "Stopped" },
  { name: "memory", icon: Brain, kind: "stdio", status: "Running" },
];

const features = [
  {
    icon: Shield,
    title: "Privacy First",
    body: "Your API keys, environment variables, and execution context never leave your machine. No telemetry, no external databases.",
  },
  {
    icon: Lock,
    title: "Secure Bridging",
    body: "Seamlessly expose local stdio servers via OpenAI Secure MCP Tunnel or ngrok SSE bridge to interact with cloud AI agents.",
  },
  {
    icon: MonitorDot,
    title: "Desktop Class",
    body: "Real-time logs, process management, connection states, and environment variable configuration in a crisp, fast interface.",
  },
  {
    icon: Code2,
    title: "Developer First",
    body: "Open source, hackable, and built for reliability. Built by developers, for developers.",
  },
];

function CommandPill({
  copied,
  onCopy,
  className = "",
}: {
  copied: boolean;
  onCopy: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onCopy}
      aria-label="Copy install command: npx tunnelcake"
      className={`group inline-flex items-center gap-2 rounded-md border border-border bg-card/60 px-3 py-2 font-mono text-sm text-foreground/90 transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${className}`}
    >
      <Terminal className="h-3.5 w-3.5 text-primary" />
      <span>npx tunnelcake</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 text-primary" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
      )}
    </button>
  );
}

export default function Home() {
  const [copied, setCopied] = useState(false);

  const copyCommand = async () => {
    try {
      if (!navigator.clipboard?.writeText) return;
      await navigator.clipboard.writeText("npx tunnelcake");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-background font-sans text-foreground selection:bg-primary/30">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-2 font-mono text-lg font-bold tracking-tight">
            <TunnelMark className="h-6 w-6" />
            <span>Tunnelcake</span>
          </div>

          <div className="hidden items-center gap-7 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target={link.href.startsWith("#") ? undefined : "_blank"}
                rel={link.href.startsWith("#") ? undefined : "noopener noreferrer"}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </div>

          <CommandPill copied={copied} onCopy={copyCommand} />
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/50">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-cover bg-right opacity-70"
          style={{ backgroundImage: `url(${heroBg})` }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/30"
        />

        <div className="container relative mx-auto grid items-center gap-12 px-6 py-20 lg:grid-cols-2 lg:gap-10 lg:py-28">
          {/* Left: copy */}
          <div>
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 font-mono text-xs font-medium text-primary">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              Local-first MCP Server Management
            </div>

            <h1 className="text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl">
              Manage your MCP servers.
              <br />
              <span className="bg-gradient-to-r from-primary to-lime-400 bg-clip-text text-transparent">
                Never leave local.
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              A desktop-class control panel for stdio MCP servers. Run locally,
              manage effortlessly, and securely expose them to ChatGPT via OpenAI
              Secure MCP Tunnel or ngrok SSE.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                size="lg"
                className="h-12 gap-2 px-7 text-base font-semibold"
                onClick={copyCommand}
              >
                {copied ? "Copied" : "Get Started"}
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 gap-2 px-7 text-base"
              >
                <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                  <Github className="h-4 w-4" />
                  View on GitHub
                </a>
              </Button>
            </div>

            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3 font-mono text-sm text-muted-foreground">
              {["Zero cloud backend", "Open source", "Your data stays local"].map(
                (item) => (
                  <div key={item} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    {item}
                  </div>
                ),
              )}
            </div>
          </div>

          {/* Right: product panel */}
          <div className="relative">
            <div className="absolute -inset-4 rounded-2xl bg-primary/10 opacity-40 blur-3xl" />
            <div className="relative overflow-hidden rounded-xl border border-border bg-card/90 shadow-2xl backdrop-blur">
              {/* window bar */}
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <TunnelMark className="h-4 w-4" />
                <span className="text-sm font-medium">Tunnelcake</span>
              </div>

              <div className="flex">
                {/* sidebar */}
                <div className="hidden w-36 shrink-0 space-y-1 border-r border-border p-3 sm:block">
                  {[
                    { icon: Server, label: "Servers", active: true },
                    { icon: Network, label: "Tunnels", active: false },
                    { icon: ScrollText, label: "Logs", active: false },
                    { icon: Settings, label: "Settings", active: false },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs font-medium ${
                        item.active
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground"
                      }`}
                    >
                      <item.icon className="h-3.5 w-3.5" />
                      {item.label}
                    </div>
                  ))}
                </div>

                {/* main */}
                <div className="flex-1 space-y-5 p-4">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Servers
                    </p>
                    <div className="space-y-2">
                      {servers.map((s) => {
                        const running = s.status === "Running";
                        return (
                          <div
                            key={s.name}
                            className="flex items-center justify-between rounded-md border border-border bg-background/60 px-3 py-2"
                          >
                            <div className="flex items-center gap-2">
                              <s.icon className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="font-mono text-xs">{s.name}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {s.kind}
                              </span>
                              <span
                                className={`flex items-center gap-1.5 font-mono text-[10px] ${
                                  running
                                    ? "text-emerald-400"
                                    : "text-muted-foreground"
                                }`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    running ? "bg-emerald-400" : "bg-muted-foreground/60"
                                  }`}
                                />
                                {s.status}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Tunnels
                    </p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                        <span className="font-mono text-xs">
                          OpenAI Secure MCP Tunnel
                        </span>
                        <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-400">
                          Active
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-md border border-border bg-background/60 px-3 py-2">
                        <span className="font-mono text-xs">ngrok SSE</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
                          Inactive
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-b border-border/50 px-6 py-24">
        <div className="container mx-auto grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/30"
            >
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="mb-2 text-lg font-bold">{f.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Connect / Security */}
      <section id="security" className="px-6 py-28">
        <div className="container mx-auto grid items-center gap-14 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Connect to the outside world,{" "}
              <span className="bg-gradient-to-r from-primary to-lime-400 bg-clip-text text-transparent">
                securely.
              </span>
            </h2>
            <p className="mt-6 max-w-md text-lg text-muted-foreground">
              stdio servers are great for local testing, but deploying them can be
              a headache. Tunnelcake includes built-in tunneling so your cloud LLMs
              can securely access your local tools.
            </p>

            <div className="mt-9 space-y-7">
              <div className="flex gap-4">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary">
                  <Zap className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h4 className="text-base font-bold">OpenAI Secure MCP Tunnel</h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    First-class support for OpenAI's official secure tunnel
                    implementation. Authenticate and expose endpoints without
                    exposing your machine.
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary">
                  <Network className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h4 className="text-base font-bold">ngrok SSE</h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Convert your stdio MCP server into an HTTP Server-Sent Events
                    stream, securely bridged to the internet via ngrok.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* terminal */}
          <div className="overflow-hidden rounded-xl border border-border bg-[#0a0d14] shadow-2xl">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-destructive/70" />
              <span className="h-3 w-3 rounded-full bg-yellow-500/70" />
              <span className="h-3 w-3 rounded-full bg-emerald-500/70" />
            </div>
            <div className="space-y-3 p-5 font-mono text-sm">
              <div className="flex items-center gap-2 text-foreground">
                <span className="text-primary">$</span> npx tunnelcake
              </div>
              <div className="flex items-center justify-between rounded border border-border bg-background/60 px-3 py-2">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  local-postgres
                </span>
                <span className="text-[11px] text-muted-foreground">stdio</span>
              </div>
              <div className="flex items-center justify-between rounded border border-primary/30 bg-primary/5 px-3 py-2">
                <span className="flex items-center gap-2 text-primary">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                  OpenAI Secure Tunnel
                </span>
                <span className="text-[11px] font-semibold text-primary">
                  ACTIVE
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border bg-card/40 px-6 py-24">
        <div className="container mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            Take control of your local AI tools.
          </h2>
          <p className="mt-5 text-lg text-muted-foreground">
            No signups. No cloud dependencies. Just run the command and start
            managing.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button
              size="lg"
              className="h-12 w-full gap-2 px-8 text-base font-semibold sm:w-auto"
              onClick={copyCommand}
            >
              {copied ? "Copied" : "Get Started"}
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
            </Button>
            <CommandPill
              copied={copied}
              onCopy={copyCommand}
              className="h-12 w-full justify-center px-8 text-base sm:w-auto"
            />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-10">
        <div className="container mx-auto flex flex-col items-center justify-between gap-4 text-sm text-muted-foreground md:flex-row">
          <div className="flex items-center gap-2 font-mono font-medium">
            <TunnelMark className="h-5 w-5" />
            Tunnelcake
          </div>
          <div className="flex items-center gap-6">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              Docs
            </a>
            <a href="#security" className="transition-colors hover:text-foreground">
              Security
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              GitHub
            </a>
            <a
              href={`${REPO_URL}/releases`}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              Changelog
            </a>
          </div>
          <p>Built for developers, by developers.</p>
        </div>
      </footer>
    </div>
  );
}
