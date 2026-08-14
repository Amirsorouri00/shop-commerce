# The platform is the thing you run, and it lives one directory down. This file exists so
# that `make up` works from the repository root as well as from inside platform/.
# Every target is forwarded verbatim — see platform/Makefile for the real definitions.

MAKEFLAGS += --no-print-directory
.DEFAULT_GOAL := help

%:
	@$(MAKE) -C platform $@
