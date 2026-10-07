# A disposable SSH remote for remote.mjs. Per-host settings arrive at `docker run` time; see start.sh.
ARG BASE=ubuntu:22.04
FROM ${BASE}
ARG NODE=24
ARG LOGIN_SHELL=bash
ARG TOOLCHAIN=none
COPY setup.sh start.sh /usr/local/lib/wb-test/
RUN sh /usr/local/lib/wb-test/setup.sh
EXPOSE 22
CMD ["/usr/local/lib/wb-test/start.sh"]
