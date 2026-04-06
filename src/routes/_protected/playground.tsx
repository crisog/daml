import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { PartyPanel } from "@/components/playground/party-panel";
import { ContractList } from "@/components/playground/contract-list";
import { CreateForm } from "@/components/playground/create-form";
import { CompileStatus } from "@/components/playground/compile-status";
import { Console, type ConsoleHandle } from "@/components/playground/console";
import { DamlEditor } from "@/editor/daml-editor";
import { ExamplePicker } from "@/components/playground/example-picker";
import { parseDamlSource } from "@/lib/playground/daml-parser";
import { EXAMPLES } from "@/lib/playground/examples";
import type { Party } from "@/lib/playground/types";
import { SandboxLoader } from "@/components/playground/sandbox-loader";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_protected/playground")({
  component: PlaygroundPage,
});

function PlaygroundPage() {
  const { user } = Route.useRouteContext();
  const [parties, setParties] = useState<Party[]>([]);
  const [activeParty, setActiveParty] = useState<Party | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [source, setSource] = useState(EXAMPLES[0]?.source ?? "");
  const [deployed, setDeployed] = useState(false);
  const consoleRef = useRef<ConsoleHandle>(null);

  const templates = useMemo(() => parseDamlSource(source), [source]);

  const handleSignOut = async () => {
    await authClient.signOut();
    window.location.href = "/login";
  };

  return (
    <SandboxLoader>
      <div className="flex h-screen flex-col bg-page text-ink">
        <header className="flex items-center gap-4 border-b border-stone bg-surface px-4 py-2">
          <h1 className="text-sm font-medium text-accent">Daml Playground</h1>
          <CompileStatus
            getSource={() => ({ "Main.daml": source })}
            onSuccess={() => {
              setDeployed(true);
              const names = templates.map((t) => t.name).join(", ");
              consoleRef.current?.success(`Deployed: ${names}`);
            }}
            onError={(err) => {
              consoleRef.current?.error(`Deploy failed: ${err}`);
            }}
          />
          <ExamplePicker
            onSelect={(src, name) => {
              setSource(src);
              setDeployed(false);
              consoleRef.current?.info(`Loaded example: ${name}`);
            }}
          />
          <span className="ml-auto flex items-center gap-3 text-xs text-ink-muted">
            {activeParty && <>Viewing as {activeParty.displayName}</>}
            <span>{user.name}</span>
            <button
              type="button"
              onClick={handleSignOut}
              className="text-ink-muted hover:text-ink"
            >
              Sign out
            </button>
          </span>
        </header>

        <div className="flex flex-1 overflow-hidden border-b border-stone">
          <div className="flex-1 border-r border-stone">
            <DamlEditor value={source} onChange={setSource} />
          </div>

          <div className="flex w-80 flex-col overflow-y-auto bg-surface">
            <PartyPanel
              parties={parties}
              activeParty={activeParty}
              onPartyCreated={(p) => {
                setParties((prev) => [...prev, p]);
                if (!activeParty) setActiveParty(p);
                consoleRef.current?.info(`Party created: ${p.displayName}`);
              }}
              onPartySelected={setActiveParty}
            />

            {!deployed && (
              <p className="p-3 text-xs text-ink-muted">
                Deploy your contract and create parties to get started
              </p>
            )}

            {deployed && parties.length > 0 && (
              <CreateForm
                templates={templates}
                parties={parties}
                onSuccess={(templateName) => {
                  setRefreshKey((k) => k + 1);
                  consoleRef.current?.success(
                    `Contract created: ${templateName}`
                  );
                }}
                onError={(err) => {
                  consoleRef.current?.error(err);
                }}
              />
            )}

            <ContractList
              partyId={activeParty?.id ?? null}
              refreshKey={refreshKey}
              templates={templates}
              parties={parties}
              onExercised={() => setRefreshKey((k) => k + 1)}
              onLog={(type, msg) => {
                if (type === "success") consoleRef.current?.success(msg);
                else consoleRef.current?.error(msg);
              }}
            />
          </div>
        </div>

        <div className="h-56 shrink-0 border-t border-stone-strong">
          <Console ref={consoleRef} />
        </div>
      </div>
    </SandboxLoader>
  );
}
