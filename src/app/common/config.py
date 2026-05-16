from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    app_name: str = "AI Test API"
    debug: bool = False
    api_prefix: str = "/api/v1"
    api_version: str = "v1"

    # LLM
    llm_provider: str = "ollama"
    model_ollama: str = "llama3.2"
    ollama_timeout: int = 600
    ollama_base_url: str = "http://localhost:11434"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    # Database
    database_url: str = "postgresql://postgres:postgres@localhost:5432/ai_test_api"
    database_test_url: str = "postgresql://postgres:postgres@localhost:5432/ai_test_api_test"

    # CORS
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    # Logging
    log_level: str = "info"
    log_format: str = "json"


settings = Settings()
