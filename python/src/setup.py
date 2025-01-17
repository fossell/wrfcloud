from setuptools import setup

setup(
    name='wrfcloud',
    version='1.1.0-dev',
    description='NCAR/RAL WRF Cloud Framework',
    author='David Hahn',
    author_email='hahnd@ucar.edu',
    maintainer='David Hahn',
    maintainer_email='hahnd@ucar.edu',
    packages=['wrfcloud', 'wrfcloud/api', 'wrfcloud/aws', 'wrfcloud/config', 'wrfcloud/jobs',
              'wrfcloud/dynamodb', 'wrfcloud/subscribers', 'wrfcloud/user', 'wrfcloud/runtime',
              'wrfcloud/runtime/tools', 'wrfcloud/setup'],
    install_requires=[
        'boto3>=1.24.8',
        'botocore>=1.27.8',
        'pyyaml>=5.4',
        'bcrypt>=3.2.0',
        'PyJWT>=2.4.0',
        'flask==2.2.3',  # TODO: flask is a pcluster dependency, but the latest version (2.3.2) breaks the API, explicitly install version 2.2.3 until pcluster team has a fix  https://github.com/aws/aws-parallelcluster/issues/5244
        'aws-parallelcluster==3.2.1',
        'f90nml>=1.4',
        'netCDF4>=1.5.0',
        'matplotlib>=3.3.0',
        'numpy==1.23.5',
        'requests>=2.20',
        'pytz>=2020.4',
        'pygrib>=2.1.4',
    ],
    package_dir={'wrfcloud': 'wrfcloud'},
    package_data={
        'wrfcloud': [
            'resources/env_vars.yaml',
            'resources/logo.jpg',
            'resources/email_templates/job_complete.html',
            'resources/email_templates/password_reset.html',
            'resources/email_templates/welcome_email.html',
            'imagebuilder/imagebuilder.yaml',
            'config/table.yaml',
            'jobs/table.yaml',
            'user/table.yaml',
            'subscribers/table.yaml',
            'aws/resources/cf_imagebuilder_wrf_intel.yaml',
            'aws/resources/cluster.wrfcloud.yaml',
            'setup/aws/cf_wrfcloud_data.yaml',
            'setup/aws/cf_wrfcloud_certificate.yaml',
            'setup/aws/cf_wrfcloud_webapp.yaml',
            'setup/resources/caribbean_6km_config.yaml',
            'setup/aws/wrfcloud_cluster_policy.json',
            'runtime/configurations/test/namelist.*',
            'runtime/resources/*.yaml',
            'api/actions/resources/run_wrf_template.sh'
        ]
    },
    include_package_data=True,
    zip_safe=True,
    entry_points={
        'console_scripts': [
            'wrfcloud-imagebuilder=wrfcloud.aws.imagebuilder:main',
            'wrfcloud-cluster=wrfcloud.aws.pcluster:main',
            'wrfcloud-run=wrfcloud.runtime.run:main',
            'wrfcloud-geojson=wrfcloud.runtime.tools.geojson:main',
            'wrfcloud-vectorjson=wrfcloud.runtime.tools.vector_json:main',
            'wrfcloud-setup=wrfcloud.setup:setup'
        ]
    },
)
