#!/bin/sh

# bcrypt 네이티브 모듈 재빌드 (볼륨 마운트로 인한 호환성 문제 해결)
echo "Rebuilding bcrypt for Alpine Linux..."
npm rebuild bcrypt --build-from-source

# 서버 실행
exec "$@"
