import * as pdfjs from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.js";
import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { useAsyncEffect, createSingleton, useSize } from "../hooks";
import { loader } from "./viewer.module.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

const useWorker = createSingleton(
  () => new pdfjs.PDFWorker({ name: "pdfjs-worker" }),
  (worker) => worker.destroy()
);

const abortify = (destroyer, errorHandler) => async (fn, signal) => {
  const task = fn();
  const aborter = () => destroyer(task);

  if (signal.aborted) {
    return aborter();
  }

  signal.addEventListener("abort", aborter, { once: true });

  const result = await errorHandler(task.promise);
  signal.removeEventListener("abort", aborter, { once: true });

  return result;
};

const wrapDoc = abortify(
  (task) => task.destroy(),
  (promise) => promise.catch((error) => console.error(error))
);

const wrapPage = abortify(
  (task) => task.cancel(),
  (promise) =>
    promise.catch((error) => {
      if (error.name !== "RenderingCancelledException") {
        return Promise.reject(error);
      }
    })
);

const WIDTH = 210;
const HEIGHT = 297;

const Viewer = ({ page: pageNumber, url }) => {
  const dpr = useRef();
  const worker = useWorker();

  const blockRef = useRef();
  const canvas1Ref = useRef();
  const canvas2Ref = useRef();
  const [document, setDocument] = useState(null);
  const [isLoading, setLoadingState] = useState(true);
  const [phase, toggle] = useReducer((v) => !v, true);

  const size = useSize(blockRef);

  useLayoutEffect(() => {
    dpr.current = Number.parseInt(window.devicePixelRatio || 1, 10);
  }, []);

  useAsyncEffect(
    async (signal) => {
      if (url) {
        const doc = await wrapDoc(
          () => pdfjs.getDocument({ url, worker }),
          signal
        );

        setDocument(doc);
      } else {
        setLoadingState(true);
        setDocument(null);
      }
    },
    [pageNumber, url]
  );

  useAsyncEffect(
    async (signal) => {
      if (document) {
        const page = await document.getPage(pageNumber);

        let viewport = page.getViewport({ scale: 1 / dpr.current });

        const scale = Math.min(
          size.height / viewport.height,
          size.width / viewport.width
        );

        viewport = page.getViewport({ scale });

        const canvas = phase ? canvas1Ref.current : canvas2Ref.current;

        if (viewport.width !== canvas.width) {
          canvas.width = viewport.width;
        }

        if (viewport.height !== canvas.height) {
          canvas.height = viewport.height;
        }

        const context = canvas.getContext("2d");

        await wrapPage(
          () => page.render({ canvasContext: context, viewport }),
          signal
        );

        toggle();
        setLoadingState(false);
      }
    },
    [document, size]
  );

  useEffect(() => {
    console.log(pageNumber);
  }, [pageNumber]);

  const ratio = size ? size.height / HEIGHT < size.width / WIDTH : 0;

  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        padding: "20px 10px 10px 10px",
      }}
    >
      <div
        ref={blockRef}
        style={{
          position: "relative",
          height: "100%",
          width: "100%",
        }}
      >
        <div
          style={{
            position: "absolute",
            border: "1px solid rgba(0, 0, 0, 0.18)",
            top: "50%",
            left: "50%",
            transform: `translate(-50%, -50%) scale(${1 / dpr.current})`,
          }}
        >
          <canvas ref={canvas1Ref} style={{ display: "block" }} />
          <canvas
            ref={canvas2Ref}
            style={{
              display: "block",
              position: "absolute",
              inset: 0,
              opacity: phase ? 1 : 0,
              transition: "opacity ease 0.1s",
            }}
          />
        </div>

        {size && isLoading && (
          <div
            className={loader}
            style={{
              width: ratio ? "unset" : size.width,
              height: ratio ? size.height : "unset",
              aspectRatio: `${WIDTH} / ${HEIGHT}`,
            }}
          />
        )}
      </div>
    </div>
  );
};

export default Viewer;
