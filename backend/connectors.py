"""
Connectors for auto-importing documents from SharePoint and Google Drive.
Provides scheduled synchronization with RBAC permission assignment.
"""
import os
import json
import asyncio
import logging
import threading
import time
from typing import Optional

logger = logging.getLogger(__name__)


class SharePointClient:
    """Client for SharePoint Online document access."""
    
    def __init__(self, site_url: str, client_id: str = None, client_secret: str = None):
        self.site_url = site_url
        self.client_id = client_id or os.getenv("SHAREPOINT_CLIENT_ID", "")
        self.client_secret = client_secret or os.getenv("SHAREPOINT_CLIENT_SECRET", "")
        self._access_token = None
        self._token_expiry = 0
    
    async def _ensure_auth(self):
        """Get OAuth2 token for SharePoint."""
        if self._access_token and time.time() < self._token_expiry:
            return
        
        if not self.client_id or not self.client_secret:
            logger.warning("SharePoint credentials not configured. Set SHAREPOINT_CLIENT_ID and SHAREPOINT_CLIENT_SECRET.")
            return
        
        import httpx
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"https://login.microsoftonline.com/common/oauth2/v2.0/token",
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "scope": "https://graph.microsoft.com/.default",
                    "grant_type": "client_credentials",
                }
            )
            if res.status_code == 200:
                data = res.json()
                self._access_token = data["access_token"]
                self._token_expiry = time.time() + data.get("expires_in", 3600) - 60
            else:
                logger.error(f"SharePoint auth failed: {res.status_code} {res.text}")
    
    def list_files(self, folder_path: str) -> list:
        """List files in a SharePoint folder. Returns list of file-like objects."""
        try:
            import httpx
            # Try using Microsoft Graph API
            base_url = f"https://graph.microsoft.com/v1.0/sites/{self.site_url}/drive/root:/{folder_path}:/children"
            headers = {"Authorization": f"Bearer {self._access_token}"}
            response = httpx.get(base_url, headers=headers, timeout=30)
            if response.status_code == 200:
                items = response.json().get("value", [])
                # Filter to only files (not folders)
                files = []
                for item in items:
                    if "file" in item:
                        files.append(type('FileObj', (), {
                            'id': item.get("id", ""),
                            'name': item.get("name", ""),
                            'size': item.get("size", 0),
                            'last_modified': item.get("lastModifiedDateTime", ""),
                        }))
                return files
            else:
                logger.warning(f"SharePoint list_files error: {response.status_code} - trying fallback")
        except Exception as e:
            logger.warning(f"SharePoint list_files exception: {e}")
        
        # Simulated fallback for development
        logger.info(f"SharePoint: listing folder {folder_path} (simulated)")
        return []

    def download(self, file_id: str) -> bytes:
        """Download a file from SharePoint by ID."""
        try:
            import httpx
            url = f"https://graph.microsoft.com/v1.0/drives/{file_id}"
            headers = {"Authorization": f"Bearer {self._access_token}"}
            response = httpx.get(url, headers=headers, timeout=60)
            if response.status_code == 200:
                return response.content
        except Exception as e:
            logger.warning(f"SharePoint download exception: {e}")
        
        logger.info(f"SharePoint: downloading file {file_id} (simulated)")
        return b""


class GoogleDriveClient:
    """Client for Google Drive document access."""
    
    def __init__(self, credentials_file: str = None):
        self.credentials_file = credentials_file or os.getenv("GOOGLE_CREDENTIALS_JSON", "")
        self._service = None
    
    def _init_service(self):
        """Initialize Google Drive service."""
        if self._service:
            return self._service
        
        if not self.credentials_file or not os.path.exists(self.credentials_file):
            logger.warning(f"Google Drive credentials not found at: {self.credentials_file}")
            return None
        
        try:
            from google.oauth2 import service_account
            from googleapiclient.discovery import build
            
            creds = service_account.Credentials.from_service_account_file(
                self.credentials_file,
                scopes=["https://www.googleapis.com/auth/drive.readonly"]
            )
            self._service = build("drive", "v3", credentials=creds)
            return self._service
        except ImportError:
            logger.warning("google-api-python-client not installed. Install with: pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib")
            return None
        except Exception as e:
            logger.error(f"Google Drive init error: {e}")
            return None
    
    def list_files(self, folder_id: str) -> list:
        """List files in a Google Drive folder."""
        service = self._init_service()
        if not service:
            logger.info(f"Google Drive: listing folder {folder_id} (simulated)")
            return []
        
        try:
            query = f"'{folder_id}' in parents and trashed=false"
            results = service.files().list(
                q=query,
                fields="files(id, name, mimeType, size, modifiedTime)",
                pageSize=50
            ).execute()
            files = results.get("files", [])
            logger.info(f"Google Drive: found {len(files)} files in folder {folder_id}")
            return files
        except Exception as e:
            logger.error(f"Google Drive list_files error: {e}")
            return []
    
    def download(self, file_id: str) -> bytes:
        """Download a file from Google Drive by ID."""
        service = self._init_service()
        if not service:
            logger.info(f"Google Drive: downloading file {file_id} (simulated)")
            return b""
        
        try:
            request = service.files().get_media(fileId=file_id)
            from googleapiclient.http import MediaIoBaseDownload
            import io
            fh = io.BytesIO()
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                status, done = downloader.next_chunk()
            return fh.getvalue()
        except Exception as e:
            logger.error(f"Google Drive download error: {e}")
            return b""


class DocumentConnector:
    """Synchronizes documents from external sources with RBAC permissions."""
    
    def __init__(self):
        self.sharepoint = SharePointClient(
            site_url=os.getenv("SHAREPOINT_SITE_URL", "https://yourcompany.sharepoint.com"),
            client_id=os.getenv("SHAREPOINT_CLIENT_ID"),
            client_secret=os.getenv("SHAREPOINT_CLIENT_SECRET")
        )
        self.google_drive = GoogleDriveClient(
            credentials_file=os.getenv("GOOGLE_CREDENTIALS_JSON")
        )
    
    async def sync_sharepoint_folder(self, folder_path: str, department: str):
        """Load all documents from a SharePoint folder with RBAC permissions."""
        from rag import pipeline, init_vector_table
        
        logger.info(f" Syncing SharePoint folder: {folder_path} for department: {department}")
        files = self.sharepoint.list_files(folder_path)
        
        if not files:
            logger.info(f"No files found in SharePoint folder {folder_path}")
            return 0
        
        synced_count = 0
        for file in files:
            try:
                logger.info(f" Syncing {file.name} from SharePoint...")
                content = self.sharepoint.download(file.id)
                if not content:
                    continue
                
                ext = file.name.rsplit(".", 1)[-1].lower() if "." in file.name else "text"
                source_type = ext if ext in ("pdf", "docx", "txt") else "text"
                
                # Index through RAG pipeline
                chunks = pipeline.prepare(file.name, content)
                if not chunks:
                    continue
                    
                embeddings = await pipeline.embed(chunks)
                await pipeline.store(file.name, chunks, embeddings, user_id=0, source_type=source_type)
                
                # Set RBAC permissions
                try:
                    from rbac import rbac
                    rbac.set_document_permissions(
                        file.name,
                        allowed_roles=['employee', 'document_manager'],
                        allowed_departments=[department],
                        confidentiality='internal'
                    )
                except ImportError:
                    pass
                
                synced_count += 1
                logger.info(f" Synced {file.name}")
            except Exception as e:
                logger.error(f" Error syncing {getattr(file, 'name', 'unknown')}: {e}")
        
        logger.info(f" SharePoint sync complete: {synced_count}/{len(files)} files")
        return synced_count
    
    async def sync_google_drive_folder(self, folder_id: str, department: str):
        """Load all documents from a Google Drive folder with RBAC permissions."""
        from rag import pipeline, init_vector_table
        
        logger.info(f" Syncing Google Drive folder: {folder_id} for department: {department}")
        files = self.google_drive.list_files(folder_id)
        
        if not files:
            logger.info(f"No files found in Google Drive folder {folder_id}")
            return 0
        
        synced_count = 0
        for file in files:
            try:
                file_name = file.get('name', 'unknown')
                file_id = file.get('id', '')
                logger.info(f" Syncing {file_name} from Google Drive...")
                
                content = self.google_drive.download(file_id)
                if not content:
                    continue
                
                ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else "text"
                source_type = ext if ext in ("pdf", "docx", "txt") else "text"
                
                # Index through RAG pipeline
                chunks = pipeline.prepare(file_name, content)
                if not chunks:
                    continue
                    
                embeddings = await pipeline.embed(chunks)
                await pipeline.store(file_name, chunks, embeddings, user_id=0, source_type=source_type)
                
                # Set RBAC permissions
                try:
                    from rbac import rbac
                    rbac.set_document_permissions(
                        file_name,
                        allowed_roles=['employee'],
                        allowed_departments=[department],
                        confidentiality='internal'
                    )
                except ImportError:
                    pass
                
                synced_count += 1
                logger.info(f" Synced {file_name}")
            except Exception as e:
                logger.error(f" Error syncing {file.get('name', 'unknown')}: {e}")
        
        logger.info(f"Google Drive sync complete: {synced_count}/{len(files)} files")
        return synced_count


# Global connector instance
connector = DocumentConnector()


def schedule_syncs():
    """Start periodic synchronization of document sources."""
    try:
        import asyncio
    except ImportError:
        logger.error("asyncio required for scheduled syncs")
        return
    
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    def run_sharepoint_sync():
        """Sync SharePoint Legal folder."""
        loop.run_until_complete(
            connector.sync_sharepoint_folder(
                os.getenv("SHAREPOINT_LEGAL_FOLDER", "/Legal/Contracts"),
                department="legal"
            )
        )
    
    def run_google_drive_sync():
        """Sync Google Drive Finance folder."""
        loop.run_until_complete(
            connector.sync_google_drive_folder(
                os.getenv("GOOGLE_DRIVE_FINANCE_FOLDER", "finance-folder-id"),
                department="finance"
            )
        )
    
    # Run initial sync
    logger.info("Running initial connector sync...")
    run_sharepoint_sync()
    run_google_drive_sync()
    
    # Schedule periodic 
    try:
        import schedule
        
        # Daily at 2 AM - SharePoint Legal
        schedule.every().day.at("02:00").do(run_sharepoint_sync)
        
        # Every hour - Google Drive Finance
        schedule.every().hour.do(run_google_drive_sync)
        
        # Also run every 30 minutes for any folder
        schedule.every(30).minutes.do(run_sharepoint_sync)
        
        logger.info("Scheduler started for connector syncs")
        
        while True:
            schedule.run_pending()
            time.sleep(60)
    except ImportError:
        logger.warning("schedule library not installed. Install with: pip install schedule")
        logger.info("Running one-time sync only.")


def start_connector_scheduler():
    """Start the connector scheduler in a background thread."""
    thread = threading.Thread(target=schedule_syncs, daemon=True)
    thread.start()
    logger.info("🔌 Connector scheduler started in background thread")
    return thread