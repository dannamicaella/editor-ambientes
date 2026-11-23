"""Export the official MobileSAM checkpoint as encoder and low-resolution prompt decoder."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

import onnx
import torch


def export(model, inputs, destination, input_names, output_names, dynamic_axes=None):
    model.eval()
    with torch.inference_mode():
        torch.onnx.export(
            model, inputs, destination, opset_version=17, do_constant_folding=True,
            input_names=input_names, output_names=output_names, dynamic_axes=dynamic_axes,
        )
    onnx.checker.check_model(destination)
    print(f"{destination.name}: {destination.stat().st_size} bytes", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Checkout of the official MobileSAM repository")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    source = args.source.resolve()
    sys.path.insert(0, str(source))
    from mobile_sam import sam_model_registry
    from mobile_sam.utils.onnx import SamOnnxModel

    class PromptDecoder(SamOnnxModel):
        def forward(self, image_embeddings, point_coords, point_labels, mask_input, has_mask_input):
            sparse = self._embed_points(point_coords, point_labels)
            dense = self._embed_masks(mask_input, has_mask_input)
            return self.model.mask_decoder.predict_masks(
                image_embeddings=image_embeddings,
                image_pe=self.model.prompt_encoder.get_dense_pe(),
                sparse_prompt_embeddings=sparse,
                dense_prompt_embeddings=dense,
            )

    torch.set_num_threads(4)
    sam = sam_model_registry["vit_t"]().eval()
    checkpoint = source / "weights" / "mobile_sam.pt"
    sam.load_state_dict(torch.load(checkpoint, map_location="cpu", weights_only=True))
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    export(sam.image_encoder, (torch.zeros(1, 3, 1024, 1024),),
           output / "encoder.onnx", ["image"], ["image_embeddings"])
    export(PromptDecoder(sam, return_single_mask=False),
           (torch.zeros(1, 256, 64, 64), torch.tensor([[[230., 220.], [0., 0.]]]),
            torch.tensor([[1., -1.]]), torch.zeros(1, 1, 256, 256),
            torch.zeros(1)), output / "decoder.onnx",
           ["image_embeddings", "point_coords", "point_labels", "mask_input", "has_mask_input"], ["masks", "scores"],
           {"point_coords": {1: "prompt_count"}, "point_labels": {1: "prompt_count"}})
    shutil.copyfile(source / "LICENSE", output / "LICENSE.txt")
    manifest = {"sourceCommit": subprocess.check_output(
        ["git", "-C", str(source), "rev-parse", "HEAD"], text=True
    ).strip(), "license": "Apache-2.0", "files": {}}
    for name in ["encoder.onnx", "decoder.onnx"]:
        path = output / name
        data = path.read_bytes()
        manifest["files"][name] = {
            "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
        }
        chunk = 16 * 1024**2
        if len(data) > chunk:
            parts = []
            for offset in range(0, len(data), chunk):
                piece = data[offset:offset + chunk]
                part = f"{name}.part{len(parts) + 1}"
                (output / part).write_bytes(piece)
                parts.append({"name": part, "bytes": len(piece)})
            manifest["files"][name]["parts"] = parts
            path.unlink()
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
