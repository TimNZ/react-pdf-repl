import { useEffect, useReducer, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import LZString from "lz-string";
import useConstant from "use-constant";
import { useAtom } from "jotai/react";
import { log } from "next-axiom/dist/logger";

import { Panel as ResizablePanel, PanelGroup } from "react-resizable-panels";

import { createSingleton, useSetState } from "../hooks";
import { Worker } from "../worker";
import Viewer from "../components/viewer";
import Tree from "../components/elements-tree";
import BoxSizing from "../components/box-sizing";
import {
  Buttons,
  Select,
  ResizeHandle,
  ScrollBox,
  DebugFont,
  DebugInfo,
  Styles,
  BoxInfo,
  PreviewPanel,
  HeaderControls,
  FooterControls,
  EmptyDebugger,
  Preview,
} from "../components/repl-layout";
import { loader } from "../components/viewer.module.css";
import {
  page as pageAtom,
  pagesCount as pagesCountAtom,
  canDecrease as canDecreaseAtom,
  canIncrease as canIncreaseAtom,
  increase as increaseAtom,
  decrease as decreaseAtom,
} from "../state/page";

import { layoutAtom, selectedAtom } from "../state/debugger";

import { code as defCode } from "../code/default-example";

const compress = (string) =>
  LZString.compressToBase64(string)
    .replace(/\+/g, "-") // Convert '+' to '-'
    .replace(/\//g, "_") // Convert '/' to '_'
    .replace(/=+$/, ""); // Remove ending '='

const decompress = (string) =>
  LZString.decompressFromBase64(
    string
      .replace(/-/g, "+") // Convert '-' to '+'
      .replace(/_/g, "/") // Convert '_' to '/'
  );

const useWorker = createSingleton(
  () => new Worker(),
  (worker) => worker.terminate()
);

const supportedVersions = [
  "3.0.2",
  "3.0.1",
  "3.0.0",
  "2.3.0",
  "2.2.0",
  "2.1.2",
  "2.1.1",
  "2.1.0",
  "2.0.21",
  "1.6.17",
];

const checkRange = (version) => {
  if (version && supportedVersions.includes(version)) return version;

  return null;
};

function useMediaQuery(query) {
  const getMatches = (query) => {
    if (typeof window !== "undefined") {
      return window.matchMedia(query).matches;
    }
    return false;
  };

  const [matches, setMatches] = useState(() => getMatches(query));

  useEffect(() => {
    function handleChange() {
      setMatches(getMatches(query));
    }

    const matchMedia = window.matchMedia(query);

    // Triggered at the first client-side load and if query changes
    handleChange();

    matchMedia.addEventListener("change", handleChange);

    return () => {
      matchMedia.removeEventListener("change", handleChange);
    };
  }, [query]);

  return matches;
}

const ClientOnly = ({ children }) => {
  const [isClient, set] = useState(false);

  useEffect(() => set(true), []);

  return isClient ? children : null;
};

const Loader = () => <div className={loader} />;

const addId = (node, parent, prefix, postfix) => {
  if (parent) node.parent = parent;
  node._id = [prefix, node.type, postfix].filter((v) => v).join("__");

  if (node.children)
    node.children.forEach((child, index) => {
      addId(child, node, node._id, index + 1);
    });

  return node;
};

const checkMode = (mode, value, { isMobile }) => {
  if (isMobile) {
    return mode[0] === value;
  } else {
    return mode.includes(value);
  }
};

const toggleMode = (mode, key, { isMobile, forcedValue }) => {
  console.log({ mode, key, isMobile, forcedValue });
  const setFromTheMode = new Set([...mode]);
  if (isMobile) {
    if (typeof forcedValue !== "undefined") {
      if (forcedValue) {
        return [key];
      }

      return [];
    }
    if (setFromTheMode.has(key)) {
      return [];
    }

    return [key];
  } else {
    if (typeof forcedValue !== "undefined") {
      if (forcedValue) {
        setFromTheMode.add(key);
      } else {
        setFromTheMode.delete(key);
      }
    } else {
      if (setFromTheMode.has(key)) {
        setFromTheMode.delete(key);
      } else {
        setFromTheMode.add(key);
      }
    }

    console.log(setFromTheMode);

    return [...setFromTheMode];
  }
};

const Repl = () => {
  const urlParams = useConstant(() => {
    if (typeof window === "undefined") return {};

    return Object.fromEntries(
      Array.from(new URLSearchParams(window.location.search).entries()).map(
        ([key, value]) => {
          if (key.startsWith("cp_")) {
            return [key.slice(3), decompress(value)];
          }

          return [key, value];
        }
      )
    );
  });

  const isMobile = useMediaQuery("(max-width: 600px)");

  const [options, updateOptions] = useSetState(() => ({
    version: checkRange(urlParams.version) ?? supportedVersions[0],
    modules: urlParams.code ? Boolean(urlParams.modules) : true,
  }));

  const [state, update] = useSetState(() => ({
    url: null,
    version: null,
    time: null,
    error: null,
    isDebuggingSupported: options.modules,
    mode: ["debug", "code"],
  }));

  const [isReady, setReady] = useState(false);
  const [code, setCode] = useState(() => urlParams.code ?? defCode);

  const [page] = useAtom(pageAtom);
  const [, setPagesCount] = useAtom(pagesCountAtom);
  const [canDecrease] = useAtom(canDecreaseAtom);
  const [, decrease] = useAtom(decreaseAtom);
  const [canIncrease] = useAtom(canIncreaseAtom);
  const [, increase] = useAtom(increaseAtom);

  const [layout, setLayout] = useAtom(layoutAtom);
  const [selectedNode] = useAtom(selectedAtom);

  const pdf = useWorker();

  const debuggerAPI = useRef();
  const editorAPI = useRef();

  useEffect(() => {
    if (options.version !== state.version) {
      setReady(false);
      pdf.call("init", options.version).then(() => setReady(true));
    }
  }, [pdf, update, state.version, options.version]);

  useEffect(() => {
    if (isReady) {
      pdf
        .call("version")
        .then(({ version, isDebuggingSupported }) =>
          update({ version, isDebuggingSupported })
        );
    }
  }, [pdf, update, isReady]);

  useEffect(() => {
    if (isReady) {
      const startTime = Date.now();
      pdf
        .call("evaluate", {
          code,
          options: { modules: options.modules },
          timeout: 20_000,
        })
        .then(({ url, layout }) => {
          if (layout) {
            setLayout(addId(layout));
          }
          update({ url, time: Date.now() - startTime, error: null });
        })
        .catch((error) => {
          if (error === "fatal_error") {
            log.error(error, { code: compress(code) });
          }
          update({ time: Date.now() - startTime, error });
        });
    }
  }, [pdf, code, update, isReady, options.modules, setLayout]);

  const editorPanel = (
    <ResizablePanel
      ref={editorAPI}
      defaultSize={50}
      minSize={20}
      collapsible
      onCollapse={(collapsed) =>
        update({
          mode: toggleMode(state.mode, "code", {
            isMobile,
            forcedValue: !collapsed,
          }),
        })
      }
    >
      <Editor
        loading={<Loader />}
        language="javascript"
        value={code}
        onChange={(newCode) => {
          setCode(newCode ?? "");
        }}
        beforeMount={(_monaco) => {
          _monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
            allowNonTsExtensions: true,
            checkJs: true,
            allowJs: true,
            noLib: true,
            jsx: "react",
          });
          _monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(
            { noSemanticValidation: true }
          );
        }}
        options={{
          wordWrap: "on",
          tabSize: 2,
          minimap: {
            enabled: false,
          },
          contextmenu: false,
        }}
      />
    </ResizablePanel>
  );

  const viewerPanel = (
    <ResizablePanel minSize={20}>
      <PanelGroup autoSaveId="react-pdf-repl-debug" direction="vertical">
        <ResizablePanel minSize={20}>
          <PreviewPanel>
            <HeaderControls>
              <Select
                time={state.time}
                value={options.version}
                onChange={(e) => {
                  update({ url: null });
                  updateOptions({ version: e.target.value });
                }}
              >
                {supportedVersions.map((version) => (
                  <option key={version}>{version}</option>
                ))}
              </Select>

              {page && (
                <div style={{ display: "flex", alignItems: "center" }}>
                  <button disabled={!canDecrease} onClick={() => decrease()}>
                    {"<"}
                  </button>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "0px 0px 3px 5px",
                    }}
                  >
                    page:
                    <div style={{ textAlign: "center", minWidth: 20 }}>
                      {page}
                    </div>
                  </div>
                  <button disabled={!canIncrease} onClick={() => increase()}>
                    {">"}
                  </button>
                </div>
              )}

              <Buttons>
                <button
                  onClick={() => {
                    const link = new URL(window.location);
                    const params = `?modules=1&version=${
                      options.version
                    }&cp_code=${compress(code)}`;
                    link.search = params;
                    navigator.clipboard.writeText(link.toString());
                  }}
                >
                  copy link
                </button>

                <button
                  onClick={() => {
                    window.open(state.url);
                  }}
                >
                  open pdf
                </button>
              </Buttons>
            </HeaderControls>

            <Preview>
              <Viewer
                url={state.url}
                page={page}
                isDebugging={checkMode(state.mode, "debug", { isMobile })}
                layout={layout}
                onParse={({ pagesCount }) => setPagesCount(pagesCount)}
              />
            </Preview>

            <FooterControls>
              <button
                onClick={() => {
                  const panel = editorAPI.current;
                  if (panel) {
                    if (checkMode(state.mode, "code", { isMobile })) {
                      panel.collapse();
                    } else {
                      panel.expand();
                    }
                  }
                }}
              >
                code
              </button>
              <button
                onClick={() => {
                  const panel = debuggerAPI.current;
                  if (panel) {
                    if (checkMode(state.mode, "debug", { isMobile })) {
                      panel.collapse();
                    } else {
                      panel.expand();
                    }
                  }
                }}
              >
                debugger
              </button>
            </FooterControls>

            {state.error && (
              <div
                style={{
                  position: "fixed",
                  bottom: 0,
                  zIndex: 10,
                  minHeight: 100,
                  width: "50%",
                  padding: 5,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    width: "100%",
                    overflow: "scroll",
                    backgroundColor: "#fec1c1",
                    border: "3px solid red",
                    padding: 15,
                  }}
                >
                  <pre style={{ margin: 0 }}>
                    {typeof state.error === "string"
                      ? state.error
                      : state.error.stack || state.error.message}
                  </pre>
                </div>
              </div>
            )}
          </PreviewPanel>
        </ResizablePanel>

        <ResizeHandle />

        <ResizablePanel
          minSize={20}
          collapsible
          onCollapse={(collapsed) =>
            update({
              mode: toggleMode(state.mode, "debug", {
                isMobile,
                forcedValue: !collapsed,
              }),
            })
          }
          ref={debuggerAPI}
        >
          {state.isDebuggingSupported ? (
            <PanelGroup
              autoSaveId="react-pdf-repl-debug-info"
              direction="horizontal"
            >
              <ResizablePanel>
                {layout && (
                  <ScrollBox>
                    <DebugFont>
                      <Tree nodes={[layout]} />
                    </DebugFont>
                  </ScrollBox>
                )}
              </ResizablePanel>
              <ResizeHandle />
              <ResizablePanel>
                <ScrollBox>
                  <DebugInfo>
                    {selectedNode && selectedNode.style && (
                      <Styles>
                        <pre>
                          {Object.entries(selectedNode.style)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join("\n")}
                        </pre>
                      </Styles>
                    )}

                    {selectedNode && (
                      <BoxInfo>
                        <BoxSizing box={selectedNode.box} />
                      </BoxInfo>
                    )}
                  </DebugInfo>
                </ScrollBox>
              </ResizablePanel>
            </PanelGroup>
          ) : (
            <EmptyDebugger>{`Debugger doesn't supported by this @react-pdf/renderer version`}</EmptyDebugger>
          )}
        </ResizablePanel>
      </PanelGroup>
    </ResizablePanel>
  );

  return (
    <ClientOnly>
      {isMobile ? (
        <PanelGroup autoSaveId="react-pdf-repl-mobile" direction="vertical">
          {viewerPanel}
          <ResizeHandle />
          {editorPanel}
        </PanelGroup>
      ) : (
        <PanelGroup autoSaveId="react-pdf-repl" direction="horizontal">
          {editorPanel}
          <ResizeHandle />
          {viewerPanel}
        </PanelGroup>
      )}
    </ClientOnly>
  );
};

export default Repl;
