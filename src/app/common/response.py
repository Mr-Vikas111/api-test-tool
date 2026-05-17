from typing import Any, Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class MetaInfo(BaseModel):
    page: int = 1
    per_page: int = 20
    total: int = 0


class ApiResponse(BaseModel, Generic[T]):
    success: bool = True
    data: T | None = None
    error: ErrorDetail | None = None
    meta: MetaInfo | None = None


def success_response(data: T, meta: MetaInfo | None = None) -> ApiResponse[T]:
    return ApiResponse(success=True, data=data, meta=meta)


def error_response(
    code: str, message: str, details: dict[str, Any] | None = None
) -> ApiResponse[None]:
    return ApiResponse(
        success=False,
        error=ErrorDetail(code=code, message=message, details=details),
    )
