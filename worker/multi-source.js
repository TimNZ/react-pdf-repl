import { createElement, Fragment } from "react";
import preprocessJsx from "./process-jsx";

import "ses";

let rpGlobals = null;
const wrap = (factory) => () =>
  factory().then((mod) => {
    console.log(mod);
    rpGlobals = mod;
  });

const versions = {
  "1.6.17": wrap(() => import("rpr1.6.17")),
  "2.0.21": wrap(() => import("rpr2.0.21")),
  "2.1.0": wrap(() => import("rpr2.1.0")),
  "2.1.1": wrap(() => import("rpr2.1.1")),
  "2.1.2": wrap(() => import("rpr2.1.2")),
  "2.2.0": wrap(() => import("rpr2.2.0")),
  "2.3.0": wrap(() => import("rpr2.3.0")),
  "3.0.0": wrap(() => import("rpr3.0.0")),
  "3.0.1": wrap(() => import("rpr3.0.1")),
};

const createRender = (callback) => (element) => {
  rpGlobals
    .pdf(element)
    .toBlob()
    .then((res) => URL.createObjectURL(res))
    .then(callback);
};

const evaluate = (code) =>
  new Promise((resolve, reject) => {
    if (!rpGlobals) {
      console.log("ere");
      reject(Error("react-pdf not found"));
    }
    const executableCode = preprocessJsx(code);
    const c = new Compartment({
      ...rpGlobals,
      render: createRender((url) => resolve(url)),
      createElement,
      Fragment,
    });

    c.evaluate(executableCode);
  });

const version = () => rpGlobals.version;

const init = (version) => {
  const initiator = versions[version];

  if (!initiator) console.log(version, versions);

  return initiator().then(() => true);
};

const methods = {
  init,
  evaluate,
  version,
};

self.addEventListener("message", (e) => {
  const { method, args, key } = e.data || e;

  const kk = methods[method] || ((v) => v);

  Promise.resolve()
    .then(() => kk(...args))
    .then((result) => postMessage({ result, key }));
});