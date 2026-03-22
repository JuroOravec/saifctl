FROM mcr.microsoft.com/playwright/python:v1.58.0-jammy
RUN pip install pytest-playwright pytest requests ruff
WORKDIR /workspace
CMD ["/usr/local/bin/test.sh"]
