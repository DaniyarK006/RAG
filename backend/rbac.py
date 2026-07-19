"""
RBAC (Role-Based Access Control) module for DocRAG.
Provides user roles, document permissions, access filtering, and audit logging.
"""
import os
import json
import logging
import psycopg2
import psycopg2.extras
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

DB_CONFIG = {
    "host":     os.getenv("PG_HOST",     "127.0.0.1"),
    "port":     int(os.getenv("PG_PORT", 5433)),
    "user":     os.getenv("PG_USER",     "postgres"),
    "password": os.getenv("PG_PASSWORD", "mysecurepassword123"),
    "database": os.getenv("PG_DB",       "offline_db"),
}

def get_conn():
    conn = psycopg2.connect(**DB_CONFIG)
    conn.autocommit = False
    return conn


def init_rbac_tables():
    """Create RBAC-related tables if they don't exist."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Users table (extends SQLAlchemy users with role/department)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS rbac_users (
                    id serial PRIMARY KEY,
                    email text UNIQUE NOT NULL,
                    password_hash text,
                    role text DEFAULT 'employee',
                    department text DEFAULT 'general',
                    active boolean DEFAULT true,
                    created_at timestamp DEFAULT now()
                );
            """)
            # Document permissions table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS document_permissions (
                    id serial PRIMARY KEY,
                    document_id text NOT NULL,
                    allowed_roles text[] DEFAULT ARRAY['admin'],
                    allowed_departments text[] DEFAULT ARRAY[],
                    confidentiality_level int DEFAULT 0,
                    created_at timestamp DEFAULT now()
                );
            """)
            # Access log table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS access_log (
                    id serial PRIMARY KEY,
                    user_id int NOT NULL,
                    document_id text,
                    query text,
                    action text,
                    timestamp timestamp DEFAULT now()
                );
            """)
            # Add document_meta_id to document_chunks if not exists
            cur.execute("""
                ALTER TABLE document_chunks 
                ADD COLUMN IF NOT EXISTS document_meta_id text;
            """)
            # Add role and department columns to existing users table if not exists
            try:
                cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role text DEFAULT 'employee';")
                cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS department text DEFAULT 'general';")
            except Exception:
                pass
        conn.commit()
    logger.info("RBAC tables initialized")


class RBACManager:
    """Manages role-based access control for documents."""

    def create_user(self, email: str, password_hash: str, role: str = "employee", department: str = "general") -> int:
        """Create a new RBAC user. Returns user_id."""
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO rbac_users (email, password_hash, role, department) "
                    "VALUES (%s, %s, %s, %s) RETURNING id",
                    (email, password_hash, role, department)
                )
                user_id = cur.fetchone()[0]
            conn.commit()
        logger.info(f"Created RBAC user {email} with role={role}, department={department}")
        return user_id

    def get_user(self, user_id: int) -> Optional[dict]:
        """Get user info by ID."""
        with get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, email, role, department, active FROM rbac_users WHERE id = %s",
                    (user_id,)
                )
                return cur.fetchone()

    def get_user_by_email(self, email: str) -> Optional[dict]:
        """Get user info by email."""
        with get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, email, role, department, active FROM rbac_users WHERE email = %s",
                    (email,)
                )
                return cur.fetchone()

    def set_document_permissions(
        self,
        document_id: str,
        allowed_roles: list[str] = None,
        allowed_departments: list[str] = None,
        confidentiality: str = "internal"
    ):
        """Set permissions for a document."""
        if allowed_roles is None:
            allowed_roles = ['admin']
        if allowed_departments is None:
            allowed_departments = []

        conf_map = {"public": 0, "internal": 1, "confidential": 2, "top-secret": 3}
        conf_level = conf_map.get(confidentiality, 1)

        with get_conn() as conn:
            with conn.cursor() as cur:
                # Upsert: delete existing then insert
                cur.execute(
                    "DELETE FROM document_permissions WHERE document_id = %s",
                    (document_id,)
                )
                cur.execute(
                    "INSERT INTO document_permissions "
                    "(document_id, allowed_roles, allowed_departments, confidentiality_level) "
                    "VALUES (%s, %s, %s, %s)",
                    (document_id, allowed_roles, allowed_departments, conf_level)
                )
            conn.commit()
        logger.info(f"Set permissions for {document_id}: roles={allowed_roles}, depts={allowed_departments}, level={conf_level}")

    def get_document_permissions(self, document_id: str) -> Optional[dict]:
        """Get permissions for a document."""
        with get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT * FROM document_permissions WHERE document_id = %s",
                    (document_id,)
                )
                return cur.fetchone()

    def check_access(self, user_id: int, document_id: str) -> bool:
        """Check if a user has access to a specific document."""
        user = self.get_user(user_id)
        if not user or not user.get('active', True):
            return False

        # Admin has access to everything
        if user['role'] == 'admin':
            return True

        # Get document permissions
        perms = self.get_document_permissions(document_id)
        if not perms:
            # No explicit permissions = accessible to all authenticated users
            return True

        # Check role
        if user['role'] not in perms.get('allowed_roles', ['admin']):
            return False

        # Check department (if specified)
        allowed_depts = perms.get('allowed_departments', [])
        if allowed_depts and user['department'] not in allowed_depts:
            return False

        return True

    def filter_chunks_by_user(self, chunks: list[dict], user_id: int) -> list[dict]:
        """Filter a list of chunks by user's access permissions."""
        if not chunks:
            return []

        # Admin sees everything
        user = self.get_user(user_id)
        if user and user.get('role') == 'admin':
            return chunks

        # Get unique document IDs
        doc_ids = list(set(c.get('filename', '') for c in chunks if c.get('filename')))
        if not doc_ids:
            return chunks

        # Check permissions for each document
        accessible_docs = set()
        for doc_id in doc_ids:
            if self.check_access(user_id, doc_id):
                accessible_docs.add(doc_id)

        return [c for c in chunks if c.get('filename') in accessible_docs]

    def log_access(self, user_id: int, document_id: str = None, query: str = None, action: str = 'view'):
        """Log an access event for audit."""
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO access_log (user_id, document_id, query, action) "
                    "VALUES (%s, %s, %s, %s)",
                    (user_id, document_id, query, action)
                )
            conn.commit()

    def get_access_log(self, limit: int = 50) -> list[dict]:
        """Get recent access log entries."""
        with get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT al.*, ru.email FROM access_log al "
                    "LEFT JOIN rbac_users ru ON al.user_id = ru.id "
                    "ORDER BY al.timestamp DESC LIMIT %s",
                    (limit,)
                )
                return [dict(r) for r in cur.fetchall()]

    def get_all_documents_with_permissions(self) -> list[dict]:
        """Get all documents with their permission settings."""
        with get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("""
                    SELECT DISTINCT dc.filename, dc.source_type,
                           dp.allowed_roles, dp.allowed_departments, dp.confidentiality_level
                    FROM document_chunks dc
                    LEFT JOIN document_permissions dp ON dc.filename = dp.document_id
                    WHERE dc.source_type != 'pending'
                    ORDER BY dc.filename
                """)
                return [dict(r) for r in cur.fetchall()]

    def get_all_users(self) -> list[dict]:
        """Get all RBAC users."""
        with get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, email, role, department, active, created_at FROM rbac_users ORDER BY id"
                )
                return [dict(r) for r in cur.fetchall()]


# Singleton instance
rbac = RBACManager()