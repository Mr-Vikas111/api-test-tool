"""FastAPI entrypoint for webhook server.

Usage:
  python webhook_server.py
  python webhook_server.py --host 0.0.0.0 --port 8080
  python webhook_server.py --model llama3.2
"""

from __future__ import annotations

import argparse
import logging

import uvicorn

from app.main import create_application


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="AI Test API webhook + Ollama runner (FastAPI)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5055)
    parser.add_argument("--model", default=None, help="Model name override")
    parser.add_argument("--provider", default=None, choices=["ollama", "openai"], help="LLM provider: 'ollama' (default) or 'openai'")
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    args = parse_args()
    app = create_application(model=args.model, provider=args.provider)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
