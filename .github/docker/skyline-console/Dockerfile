ARG KOLLA_SKYLINE_CONSOLE_IMAGE=quay.io/openstack.kolla/skyline-console:master-ubuntu-noble
FROM ${KOLLA_SKYLINE_CONSOLE_IMAGE}

USER root

COPY skyline-console.tar.gz /tmp/skyline-console.tar.gz

RUN rm -rf /skyline-console /skyline-console-source \
    && mkdir -p /skyline-console-source \
    && tar -xzf /tmp/skyline-console.tar.gz -C /skyline-console-source \
    && ln -s /skyline-console-source/* /skyline-console \
    && python3 -m pip --no-cache-dir install --force-reinstall --no-deps --no-build-isolation /skyline-console \
    && rm -f /tmp/skyline-console.tar.gz

USER root
