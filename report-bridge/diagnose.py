"""Local R5 diagnostics; does not print keys or NAS credentials."""
import argparse,json,sys
from pathlib import Path
from server import Bridge,load_config

def main():
 if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8',errors='replace')
 parser=argparse.ArgumentParser();parser.add_argument('--config',default=str(Path(__file__).resolve().with_name('config.json')));parser.add_argument('--site-id',type=int,default=7523);args=parser.parse_args()
 try:
  config=load_config(args.config);db=Path(config['database'])
  if not db.is_file():
   print(json.dumps({'error':'기존 연결 DB가 이 위치에 없습니다. 새 DB를 만들지 않았습니다. 기존 DB 위치를 config.json의 database에 지정하세요.','config_file':config['config_file'],'expected_database':str(db)},ensure_ascii=False,indent=2));return 1
  bridge=Bridge(config);print(json.dumps(bridge.diagnostics(args.site_id),ensure_ascii=False,indent=2));return 0
 except Exception as error:
  print(json.dumps({'error_type':type(error).__name__,'message':'설정 또는 기존 연결 DB를 읽지 못했습니다. 설정 파일과 폴더 권한을 확인하세요.'},ensure_ascii=False,indent=2));return 1
if __name__=='__main__':raise SystemExit(main())
