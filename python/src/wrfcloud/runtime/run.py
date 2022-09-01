#!/usr/bin/env python3

"""
Wrapper script for creating, submitting, and monitoring runs of the wrfcloud framework.

This script takes a single argument: --name='name' should be set to a unique alphanumeric name
for this particular run of the system. If no name is given, a test configuration will be
run.
"""

import argparse
import os
from wrfcloud.runtime.ungrib import Ungrib
from wrfcloud.runtime.metgrid import MetGrid
from wrfcloud.runtime.real import Real
from wrfcloud.runtime.wrf import Wrf
from wrfcloud.runtime.postproc import PostProc
from wrfcloud.runtime import RunInfo
from wrfcloud.system import init_environment
from wrfcloud.log import Logger


def main() -> None:
    """
    Main routine that creates a new run and monitors it through completion
    """
    init_environment('production')
    log = Logger()

    log.debug('Reading command line arguments')
    parser = argparse.ArgumentParser()
    parser.add_argument('--name', type=str, default='test',
                        help='"name" should be a unique alphanumeric name for this particular run')
    args = parser.parse_args()
    name = args.name

    log.info(f'Starting new run "{name}"')
    log.debug('Creating new RunInfo')
    runinfo = RunInfo(name)
    log.info(f'Setting up working directory {runinfo.wd}')
    log.debug(f'Moving setup.log to {runinfo.wd}')

    log.debug('Initialize environment variables for specified configuration')
    init_environment(runinfo.configuration)

    log.debug('Starting ungrib task')
    ungrib = Ungrib(runinfo)
    ungrib.start()
    log.debug(ungrib.get_run_summary())

    log.debug('Starting metgrid task')
    metgrid = MetGrid(runinfo)
    metgrid.start()
    log.debug(metgrid.get_run_summary())

    log.debug('Starting real task')
    real = Real(runinfo)
    real.start()
    log.debug(real.get_run_summary())

    log.debug('Starting wrf task')
    wrf = Wrf(runinfo)
    wrf.start()
    log.debug(wrf.get_run_summary())

    log.debug('Starting postproc task')
    postproc = PostProc(runinfo)
    postproc.start()
    log.debug(postproc.get_run_summary())


if __name__ == "__main__":
    main()
