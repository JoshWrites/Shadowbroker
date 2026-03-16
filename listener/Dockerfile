FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

# Data volume — one SQLite DB per signal
VOLUME ["/data"]

EXPOSE 7654

CMD ["python", "main.py"]
