import socket
import urllib.request
import json
import sys

def check_port(host, port):
    try:
        with socket.create_connection((host, port), timeout=2):
            return True
    except OSError:
        return False

def check_ollama():
    print("[1/2] Checking Ollama server...")
    if not check_port("localhost", 11434):
        print("Ollama is not running on http://localhost:11434")
        print("Please download Ollama from https://ollama.com/download/windows, install and run the application")
        return False
    
    try:
        req = urllib.request.Request("http://localhost:11434/api/tags")
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            models = [m['name'] for m in data.get('models', [])]
            print("Ollama is running!")
            print(f"   Available models: {', '.join(models) if models else 'no models available'}")
        
            required_models = ["qwen2.5-coder:7b", "nomic-embed-text:latest"]
            for model in required_models:
                has_model = any(model.split(':')[0] in m for m in models)
                if has_model:
                    print(f"   - Model {model}: Downloaded and ready")
                else:
                    print(f"   - Model {model}: Not found (please download it using 'ollama run {model}')")
            return True
    except Exception as e:
        print(f"Failed to connect at Ollama API: {e}")
        return False

def check_postgres():
    print("\n[2/2] Checking PostgreSQL database...")
    if not check_port("localhost", 5433):
        print("PostgreSQL is not running on port 5433")
        print("Please start Docker Desktop and run 'docker compose up -d' in the project folder")
        return False
    
    print("PostgreSQL port 5433 is open!")
    print("On the next step we will check for the presence of the pgvector extension")
    return True

if __name__ == "__main__":
    ollama_ok = check_ollama()
    pg_ok = check_postgres()
    
    if ollama_ok and pg_ok:
        print("All checks passed! Your environment is ready for the project")
        sys.exit(0)
    else:
        print("Please fix the issues mentioned above to continue")
        sys.exit(1)
