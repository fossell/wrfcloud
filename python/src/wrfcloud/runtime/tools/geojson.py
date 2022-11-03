"""
Module to convert WRF output to GeoJSON
"""
import pkgutil
from concurrent.futures import ProcessPoolExecutor
from typing import Union, List
from gzip import compress
import json
import yaml
import netCDF4
from matplotlib import colors
from matplotlib import contour
from matplotlib import pyplot
import numpy
from numpy.ma.core import MaskedArray
from wrfcloud.log import Logger
import pygrib


class GeoJson:
    """
    Class to convert WRF output to GeoJSON MultiPolygon format
    """
    def __init__(self, wrf_file: str, file_type: str, variable: str, value_range: List[float],
                 contour_interval: float, palette: str, z_level: Union[int, None] = None):
        """
        Construct a WRF to GeoJSON converter
        :param wrf_file: Full path to the WRF output file
        :param file_type: File type can be either 'grib2' or 'netcdf'
        :param variable: Name of the variable in the NetCDF file to convert
        :param value_range: List of exactly two floats [0]=min [1]=max
        :param contour_interval: Value difference between contour levels
        :param palette: Name of the color palette
        :param z_level: Height level in the to convert
        """
        self.log = Logger(self.__class__.__name__)
        self.wrf_file = wrf_file
        self.file_type = file_type
        self.variable = variable
        self.z_level = z_level
        self.grid = None
        self.grid_lat = None
        self.grid_lon = None
        self.min = value_range[0]
        self.max = value_range[1]
        self.contour_interval = contour_interval
        self.palette = palette

    def convert(self, out_file: Union[str, None]) -> Union[None, dict]:
        """
        Convert a field in a WRF output file to GeoJSON
        :param out_file: Full path to the output file (directory must exist) or None to get the
                         GeoJSON data returned as a dictionary
        """
        # log status info
        self.log.info(f'Converting {self.variable} to {out_file}')

        # get the data, lat, and lon grids
        if self.file_type == 'grib2':
            grid, self.grid_lat, self.grid_lon = self._read_from_grib()
        elif self.file_type == 'netcdf':
            grid, self.grid_lat, self.grid_lon = self._read_from_netcdf()
        else:
            self.log.error(f'Invalid file type: {self.file_type}.  Valid types are "netcdf" and "grib2".')
            return None

        # create a set of contours from the data grid
        range_min = int(self.min * 10)
        range_max = int(self.max * 10)
        ci = int(self.contour_interval*10)
        levels = [i/10 for i in range(range_min, range_max, ci)]
        contours: contour.QuadContourSet = pyplot.contourf(grid, levels=levels, cmap=self.palette)

        # create a set of features for the GeoJSON file
        features = []

        # loop over each contour level
        for i, contour_line in enumerate(contours.collections):
            # get the hex color for this level
            level_color = colors.rgb2hex(contours.tcolors[i][0])

            # loop over each outer polygon and set of interior holes
            for path in contour_line.get_paths():

                # get the list of polygons for this set
                path_polygons = path.to_polygons()

                # skip if there are no polygons
                if len(path_polygons) == 0:
                    continue

                # the first polygon in the list is the outer polygon
                outer_polygon = self._polygon_to_coord_array(path_polygons[0])

                # the remaining polygons are holes in the outer polygon
                holes = [self._polygon_to_coord_array(hole) for hole in path_polygons[1:]]

                # get the string of the MultiPolygon coordinates for outer polygon and holes
                polygon_string = self._polygon_and_holes_to_multi_polygon(outer_polygon, holes)

                # create a GeoJSON feature as a dictionary
                feature = {
                    "type": "Feature",
                    "geometry": {
                        "type": "MultiPolygon",
                        "coordinates": [json.loads(polygon_string)]
                    },
                    "properties": {
                        # "stroke-width": 0,  has no effect in OpenLayers and only makes the data set larger
                        "fill": level_color
                        # "fill-opacity": 1   has no effect in OpenLayers and only makes the data set larger
                    }
                }

                # add this MultiPolygon feature to the set of features
                features.append(feature)

        # create the GeoJSON document
        doc = {
            "type": "FeatureCollection",
            "features": features
        }

        # return the document if no output file was provided
        if out_file is None:
            return doc

        # write the data to a file or return as a string if no data were
        with open(out_file, 'wb') as file:
            file.write(compress(json.dumps(doc).encode()))
            file.flush()
            file.close()
        return None

    def _read_from_netcdf(self) -> (MaskedArray, MaskedArray, MaskedArray):
        """
        Read the variable data, latitude, and longitude grids from a NetCDF file
        :return: data, latitude, longitude
        """
        # open the NetCDF file and get the requested horizontal slice
        # pylint thinks that the Dataset class does not exist in netCDF4 pylint: disable=E1101
        wrf = netCDF4.Dataset(self.wrf_file)
        data = wrf[self.variable]
        time_index = 0
        grid = data[time_index][self.z_level] if self.z_level else data[time_index]

        # get the latitude and longitude grids
        grid_lat = wrf['XLAT'][0]
        grid_lon = wrf['XLONG'][0]

        return grid, grid_lat, grid_lon

    def _read_from_grib(self) -> (MaskedArray, MaskedArray, MaskedArray):
        """
        Read the variable data, latitude, and longitude grids from a GRIB2 file
        :return: data, latitude, longitude
        """
        # read grib2 file with pygrib & eccodes
        wrf = pygrib.open(self.wrf_file)
        variable = wrf.select(shortName=self.variable)[self.z_level if self.z_level else 0]
        values = variable.values
        grid = MaskedArray(values)

        # get the latitude and longitude grids
        grid_lat = MaskedArray(wrf.select(shortName='nlat')[0].values)
        grid_lon = MaskedArray(wrf.select(shortName='elon')[0].values) - 360

        return grid, grid_lat, grid_lon

    @staticmethod
    def _1d_to_2d(data: MaskedArray, x: int, y: int) -> MaskedArray:
        """
        Convert a 1D array to a 2D grid
        :param data: Data array to convert
        :param x: X dimension
        :param y: Y dimension
        :return: 2D grid
        """
        data2d = []
        for i in range(0, x*y, x):
            data2d.append(data[i:i+x])

        return MaskedArray(data2d, ndmin=2)

    def _grid_to_lonlat(self, x: float, y: float) -> (float, float):
        """
        Convert grid XY coordinates to longitude and latitude
        :param x: The X position on the grid
        :param y: The Y position on the grid
        :return: Longitude and latitude
        """
        # get the integer grid indices
        x1 = int(x)
        y1 = int(y)
        x2 = int(x) + 1 if x1 != round(x, 5) else x1
        y2 = int(y) + 1 if y1 != round(y, 5) else y1

        # get bounding lat/lon values for a linear interpolation
        lat1 = self.grid_lat[y1][x1]
        lon1 = self.grid_lon[y1][x1]
        lat2 = self.grid_lat[y2][x2]
        lon2 = self.grid_lon[y2][x2]

        # get the x and y grid value fractions for a linear interpolation
        x_frac = x - x1
        y_frac = y - y1

        # compute lat/lon values with a linear interpolation
        lat = lat1 + ((lat2 - lat1) * y_frac)
        lon = lon1 + ((lon2 - lon1) * x_frac)

        return round(lon, 5), round(lat, 5)

    def _polygon_to_coord_array(self, polygon: numpy.ndarray) -> list[(float, float)]:
        """
        Convert a polygon contour path to a coordinate array
        """
        points = []
        for point in polygon:
            lonlat_point = self._grid_to_lonlat(point[0], point[1])
            points.append(lonlat_point)

        return points

    @staticmethod
    def _polygon_and_holes_to_multi_polygon(polygon: list[list[float]], holes: list[list[list[float]]]) -> str:
        """
        Convert a polygon and zero or more holes to a GeoJSON multi-polygon coordinate string
        :param polygon: List of polygon coordinates
        :param holes: List of holes, where each hole is a list of polygon coordinates
        :return: GeoJSON-formatted MultiPolygon coordinate string
        """
        mp_str = str([[point[0], point[1]] for point in polygon])
        for hole in holes:
            mp_str += ',' + str([[point[0], point[1]] for point in hole])
        return '[' + mp_str + ']'


def main():
    """
    Command line entry point to run the converter
    """
    from argparse import ArgumentParser

    # parse the command line parameters
    parser = ArgumentParser(description='Convert WRF (netCDF or GRIB2) to GeoJSON format')
    parser.add_argument('--type', type=str, help='"grib2" or "netcdf"', required=True)
    parser.add_argument('--in-file', type=str, help='Full path to the WRF file', required=True)
    parser.add_argument('--out-file', type=str, help='Full path to the output file', required=False)
    parser.add_argument('--variable', type=str, help='Variable from the WRF file, required if auto not set', required=False)
    parser.add_argument('--min', type=float, help='Color palette\'s min value range, required if auto not set', required=False)
    parser.add_argument('--max', type=float, help='Color palette\'s max value range, required if auto not set', required=False)
    parser.add_argument('--palette', type=str, help='Color palette name https://matplotlib.org/stable/gallery/color/colormap_reference.html', required=False)
    parser.add_argument('--contour-interval', type=float, help='Value difference between contour levels, required if auto not set', required=False)
    parser.add_argument('--z-level', type=int, help='Z-level if a 3D field', required=False)
    parser.add_argument('--auto', help='Automatically creates full output set', required=False, action='store_true')
    args = parser.parse_args()

    # get the command line parameters
    file_type = args.type
    wrf_file = args.in_file
    out_file = args.out_file or None
    variable = args.variable
    z_level = args.z_level or None
    value_range = [args.min, args.max]
    contour_interval = args.contour_interval
    palette = args.palette
    auto = args.auto

    # select mode and convert the WRF data to GeoJSON
    if not auto:
        _manual_product(wrf_file, file_type, out_file, variable, value_range, contour_interval, palette, z_level)
    else:
        _automate_products(wrf_file, file_type)


def _manual_product(wrf_file: str, file_type: str, out_file: Union[str, None], variable: str, value_range: List[float],
                    contour_interval: float, palette: str, z_level: Union[int, None]) -> None:
    """
    Generate a single product defined by manual CLI inputs
    :param wrf_file: Input file name
    :param file_type: grib2 or netcdf
    :param out_file: Output file name or None if stdout is desired
    :param variable: Variable name in the file
    :param z_level: Vertical level to export, or None if a 2D variable
    """
    # convert the WRF data to GeoJSON
    converter = GeoJson(wrf_file, file_type, variable, value_range, contour_interval, palette, z_level)
    output = converter.convert(out_file)

    # print the output to stdout if we do not have an output file
    if output is not None:
        print(json.dumps(output, indent=2))


def _automate_products(wrf_file: str, file_type: str) -> None:
    """
    Generate all the products defined in the geojson_products.yaml file
    :param wrf_file: Input file name
    :param
    """
    # load the product list from the yaml file
    products_data = pkgutil.get_data('wrfcloud', 'runtime/resources/geojson_products.yaml')
    products = yaml.safe_load(products_data)['products']

    # create a process pool for concurrent execution
    ppe = ProcessPoolExecutor(max_workers=8)
    futures = []

    # create each product
    for product in products:
        variable = product[file_type]['variable']
        value_range = [product['range']['min'], product['range']['max']]
        contour_interval = product['contour_interval']
        palette = product['palette']
        z_levels = product['z_levels'] if 'z_levels' in product else [None]
        for z_level in z_levels:
            out_file = (f'{wrf_file}_{variable}' if z_level is None else f'{wrf_file}_{variable}_{z_level}')
            out_file += '.geojson.gz'
            converter = GeoJson(wrf_file, file_type, variable, value_range, contour_interval, palette, z_level)
            future = ppe.submit(converter.convert, out_file)
            futures.append(future)

    for future in futures:
        future.result()


if __name__ == '__main__':
    main()
