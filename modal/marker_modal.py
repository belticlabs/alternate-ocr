"""Modal GPU backend for Marker-PDF (H100).

Copied from research/marker/marker_modal.py for this repo.

Deploy:  modal deploy modal/marker_modal.py
Dev:     modal serve modal/marker_modal.py

Next.js sends POST JSON: { "file": "<base64>", "filename": "doc.pdf", "output_format": "json" }
JSON responses use Pydantic model_dump(mode="json") so `text` is real JSON, not repr().
"""

import base64
import json
import os
import time

import modal

app = modal.App("marker-gpu")

# Persistent volume for uploaded docs, results, and logs
vol = modal.Volume.from_name("marker-data", create_if_missing=True)
VOL_PATH = "/data"


def download_models():
    """Pre-download Marker/Surya weights during image build."""
    from marker.models import create_model_dict

    create_model_dict()
    print("Marker models downloaded successfully.")


image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.0-devel-ubuntu22.04", add_python="3.11"
    )
    .pip_install(
        "torch",
        "torchvision",
        "packaging",
        "psutil",
    )
    .pip_install(
        "marker-pdf>=1.0.0",
        "Pillow",
        "PyMuPDF",
        "fastapi[standard]",
    )
    .run_function(download_models)
)


@app.cls(gpu="H100", timeout=1800, scaledown_window=300, image=image, volumes={VOL_PATH: vol})
class MarkerOCR:
    @modal.enter()
    def load_models(self):
        import torch
        from marker.models import create_model_dict

        t0 = time.time()

        if torch.cuda.is_available():
            gpu_name = torch.cuda.get_device_name(0)
            props = torch.cuda.get_device_properties(0)
            vram_gb = getattr(props, "total_memory", getattr(props, "total_mem", 0)) / (1024**3)
            print(f"GPU: {gpu_name} ({vram_gb:.1f} GB VRAM)")

        self._models = create_model_dict()
        self._model_load_time = time.time() - t0
        print(f"Marker models loaded in {self._model_load_time:.2f}s")

    def _convert(self, pdf_bytes: bytes, filename: str, output_format: str, force_ocr: bool) -> dict:
        """Core conversion logic. Saves uploads + results to /data volume."""
        import torch
        from marker.converters.pdf import PdfConverter
        from marker.config.parser import ConfigParser

        t_start = time.time()
        run_id = f"{int(t_start)}_{filename}"

        uploads_dir = f"{VOL_PATH}/uploads"
        os.makedirs(uploads_dir, exist_ok=True)
        upload_path = f"{uploads_dir}/{run_id}"
        with open(upload_path, "wb") as f:
            f.write(pdf_bytes)

        tmp_path = f"/tmp/{os.path.basename(filename) or 'document.pdf'}"
        with open(tmp_path, "wb") as f:
            f.write(pdf_bytes)

        config_kwargs = {
            "output_format": output_format,
            "force_ocr": force_ocr,
        }
        config_parser = ConfigParser(config_kwargs)
        config_dict = config_parser.generate_config_dict()
        # Modal/serverless: avoid multiprocessing issues (see modal-labs modal-examples doc_ocr_jobs)
        config_dict["pdftext_workers"] = 1

        converter = PdfConverter(
            config=config_dict,
            artifact_dict=self._models,
            processor_list=config_parser.get_processors(),
            renderer=config_parser.get_renderer(),
        )

        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()

        t_convert_start = time.time()
        rendered = converter(tmp_path)
        t_convert = time.time() - t_convert_start

        if output_format == "json":
            # JSON-serializable dict for HTTP (never str/repr the model)
            text = rendered.model_dump(mode="json")
            num_pages = len(text.get("children", [])) or 1
        elif hasattr(rendered, "markdown"):
            text = rendered.markdown
            num_pages = 1
        elif hasattr(rendered, "text"):
            text = rendered.text
            num_pages = 1
        else:
            text = str(rendered)
            num_pages = 1

        if output_format != "json":
            if hasattr(rendered, "metadata") and rendered.metadata:
                meta = rendered.metadata if isinstance(rendered.metadata, dict) else {}
                if isinstance(rendered.metadata, dict):
                    num_pages = meta.get("pages", num_pages) or num_pages
            if hasattr(converter, "page_count") and converter.page_count:
                num_pages = converter.page_count

        peak_mem_mb = None
        if torch.cuda.is_available():
            peak_mem_mb = round(torch.cuda.max_memory_allocated() / (1024**2), 1)

        total_time = time.time() - t_start
        text_length = len(json.dumps(text)) if isinstance(text, dict) else len(text)

        result = {
            "text": text,
            "num_pages": num_pages,
            "text_length": text_length,
            "convert_time_s": round(t_convert, 3),
            "total_time_s": round(total_time, 3),
            "per_page_s": round(t_convert / max(num_pages, 1), 3),
            "pages_per_s": round(max(num_pages, 1) / max(t_convert, 0.001), 3),
            "model_load_s": round(self._model_load_time, 3),
            "peak_gpu_mem_mb": peak_mem_mb,
        }

        try:
            results_dir = f"{VOL_PATH}/results"
            logs_dir = f"{VOL_PATH}/logs"
            os.makedirs(results_dir, exist_ok=True)
            os.makedirs(logs_dir, exist_ok=True)

            if isinstance(text, dict):
                with open(f"{results_dir}/{run_id}.json", "w") as f:
                    json.dump(text, f, indent=2)
            else:
                with open(f"{results_dir}/{run_id}.md", "w") as f:
                    f.write(text)

            log_entry = {k: v for k, v in result.items() if k != "text"}
            log_entry["filename"] = filename
            log_entry["run_id"] = run_id
            log_entry["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            with open(f"{logs_dir}/{run_id}.json", "w") as f:
                json.dump(log_entry, f, indent=2)

            vol.commit()
        except Exception as e:
            print(f"Warning: failed to save to volume: {e}")

        return result

    @modal.fastapi_endpoint(method="POST", docs=True)
    async def convert(self, request: dict):
        """Convert PDF/image via Marker.

        JSON body:
            file (required): base64 document bytes
            filename (optional)
            output_format (optional): markdown | json | html
            force_ocr (optional): bool
        """
        from fastapi.responses import JSONResponse

        if "file" not in request:
            return JSONResponse(
                status_code=400,
                content={"error": "Missing 'file' field (base64-encoded PDF)"},
            )

        try:
            pdf_bytes = base64.b64decode(request["file"])
        except Exception:
            return JSONResponse(
                status_code=400,
                content={"error": "Invalid base64 in 'file' field"},
            )

        filename = request.get("filename", "document.pdf")
        output_format = request.get("output_format", "markdown")
        force_ocr = request.get("force_ocr", False)

        t0 = time.time()
        result = self._convert(pdf_bytes, filename, output_format, force_ocr)
        result["wall_time_s"] = round(time.time() - t0, 3)

        return result

    @modal.fastapi_endpoint(method="GET", docs=True)
    def health(self):
        return {
            "status": "ok",
            "model_load_s": self._model_load_time,
        }

    @modal.method()
    def convert_pdf(
        self,
        pdf_bytes: bytes,
        filename: str = "document.pdf",
        output_format: str = "markdown",
        force_ocr: bool = False,
    ) -> dict:
        return self._convert(pdf_bytes, filename, output_format, force_ocr)


@app.local_entrypoint()
def main(
    pdf_path: str = "test.pdf",
    output_format: str = "markdown",
    force_ocr: bool = False,
    save_output: bool = True,
):
    print(f"Processing: {pdf_path}")

    with open(pdf_path, "rb") as f:
        pdf_bytes = f.read()

    filename = os.path.basename(pdf_path)
    ocr = MarkerOCR()

    t0 = time.time()
    result = ocr.convert_pdf.remote(pdf_bytes, filename, output_format, force_ocr)
    wall_time = time.time() - t0

    print(f"\n{'='*60}")
    print(f"Marker-PDF on Modal GPU")
    print(f"{'='*60}")
    print(f"  Document:       {filename}")
    print(f"  Pages:          {result['num_pages']}")
    print(f"  Output length:  {result['text_length']:,} chars")
    print(f"  Model load:     {result['model_load_s']:.2f}s")
    print(f"  Conversion:     {result['convert_time_s']:.2f}s")
    print(f"  Wall time:      {wall_time:.2f}s")

    if save_output:
        stem = os.path.splitext(filename)[0]
        if isinstance(result["text"], dict):
            text_path = f"benchmarks/reports/{stem}.json"
            os.makedirs(os.path.dirname(text_path), exist_ok=True)
            with open(text_path, "w") as f:
                json.dump(result["text"], f, indent=2)
        else:
            text_path = f"benchmarks/reports/{stem}.md"
            os.makedirs(os.path.dirname(text_path), exist_ok=True)
            with open(text_path, "w") as f:
                f.write(result["text"])
        print(f"\n  Saved text:     {text_path}")
