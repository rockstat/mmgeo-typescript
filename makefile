
bump-patch:
	yarn version --loose-semver --new-version patch

bump-minor:
	bumpversion minor


build:
	docker build -t mmgeo_typescript .

build_amd64:
	docker buildx build --platform linux/amd64 -t mmgeo_typescript .	

tag-ng:
	docker tag mmgeo_typescript rockstat/mmgeo_typescript:ng

tag-latest:
	docker tag mmgeo_typescript rockstat/mmgeo_typescript:latest

push-latest:
	docker push rockstat/mmgeo_typescript:latest

push-ng:
	docker push rockstat/mmgeo_typescript:ng

all-ng: build_amd64 tag-ng push-ng

push-dev:
	docker tag mmgeo_typescript rockstat/mmgeo_typescript:dev
	docker push rockstat/mmgeo_typescript:dev

to_master:
	@echo $(BR)
	git checkout master && git merge $(BR) && git checkout $(BR)
