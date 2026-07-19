from pydantic import BaseModel, EmailStr
from typing import Optional


class RegisterRequest(BaseModel):
    username: str
    password: str
    email: Optional[str] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: int
    username: str
    email: Optional[str]
    oauth_provider: Optional[str]

    class Config:
        from_attributes = True


class FeedbackRequest(BaseModel):
    query: str
    answer: str
    score: int
    comment: Optional[str] = None


class ChatRequest(BaseModel):
    message: str
    project: Optional[str] = None
