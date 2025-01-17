import {Component, OnInit} from '@angular/core';
import {AppComponent} from "../app.component";
import {
  WrfJob,
  LayerRequest,
  GetWrfGeoJsonRequest,
  GetWrfGeoJsonResponse,
  ListJobRequest, ListJobResponse, WrfLayerGroup, WrfLayer, VectorData
} from "../client-api";
import {Map, View} from 'ol';
import TileLayer from 'ol/layer/Tile';
import {OSM, TileWMS} from 'ol/source';
import {MatSliderChange} from "@angular/material/slider";
import {useGeographic, fromLonLat} from "ol/proj";
import VectorSource from "ol/source/Vector";
import {GeoJSON} from "ol/format";
import VectorLayer from "ol/layer/Vector";
import {Fill, Stroke, Style, RegularShape} from "ol/style";
import {Layer} from "ol/layer";
import {Size} from "ol/size";
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';

@Component({
  selector: 'app-wrf-viewer',
  templateUrl: './wrf-viewer.component.html',
  styleUrls: ['./wrf-viewer.component.sass']
})
export class WrfViewerComponent implements OnInit
{
  /**
   * Singleton viewer component
   */
  public static singleton: WrfViewerComponent;


  /**
   * App singleton object
   */
  public app: AppComponent;


  /**
   * Flag indicating that the user was warned and still really wants to see this on a mobile view
   */
  public forceMobile: boolean = false;


  /**
   * List of visible animation controls
   */
  public animationControls: string[] = ['back', 'play', 'forward'];


  /**
   * Flag to tell us if we are animating
   */
  public playing: boolean = false;


  /**
   * Delay in milliseconds between
   */
  public animationDelayMs: number = 100;


  /**
   * List of animation frames
   */
  public animationFrames: Date[] = [];


  /**
   * The selected animation frame
   */
  public selectedFrameMs: number = 0;


  /**
   * WRF job definition
   */
  public job: WrfJob|undefined;


  /**
   * A list of layers taken from the job
   */
  public layers: WrfLayer[] = [];


  /**
   * Layer groups organized by variable name
   */
  public layerGroups: WrfLayerGroup[] = [];


  /**
   * OpenLayers map
   */
  private map: Map|undefined;


  /**
   * Layer containing political boundaries
   * @private
   */
  private politicalBoundariesLayer: Layer|undefined;


  /**
   * Flag to indicate if political boundaries are visible or not
   * @private
   */
  public politicalBoundariesVisible: boolean = false;


  /**
   * List of valid height value selections
   */
  public validHeights: number[] = [100, 250, 300, 500, 700, 850, 925, 1000];


  /**
   * Initialize the layer request
   */
  public req: LayerRequest = {
    height: this.validHeights[this.validHeights.length - 1]
  };


  /**
   * A map to store data frames, which are OL6 GeoJSON Layers
   */
  public frames: {[key: string]: Layer} = {};


  /**
   * Get the singleton app object
   */
  constructor()
  {
    WrfViewerComponent.singleton = this;
    this.app = AppComponent.singleton;

    /* request the job information */
    this.sendGetJobRequest();
  }


  /**
   * Initialize when the view is ready
   */
  ngOnInit(): void
  {
  }


  /**
   * Initialize when the view is ready
   */
  ngAfterViewInit(): void
  {
    this.initMap();
  }


  /**
   * Initialize the map
   * @private
   */
  private initMap(): void
  {
    /* wait for the job to be defined */
    if (this.job === undefined)
    {
      setTimeout(this.initMap.bind(this), 100);
      return;
    }

    useGeographic();
    this.map = new Map({
      target: 'map',
      layers: [
        new TileLayer({source: new OSM()}),
      ],
      view: new View({
        center: [
          this.job.domain_center.longitude,
          this.job.domain_center.latitude
        ],
        zoom: 1
      })
    });

    /* add a political boundaries layer that will sit on top of all other layers */
    this.politicalBoundariesLayer = new TileLayer({
      source: new TileWMS({
        url: 'https://gis-maps.rap.ucar.edu/arcgis/services/POLITICAL_BASEMAP/MapServer/WMSServer',
        params: {'LAYERS': '1,2,3,4,5,6,7', 'TRANSPARENT': true}
      }),
    });
    this.politicalBoundariesLayer.setZIndex(100);
    this.map.addLayer(this.politicalBoundariesLayer);
    this.politicalBoundariesVisible = this.politicalBoundariesLayer.getVisible();

    /* adjust the zoom extent */
    const zoom: number = this.computeZoomLevel();
    this.map.getView().setZoom(zoom);

    /* sometimes we strangely lose the map center, so set it again */
    this.map.getView().setCenter([this.job.domain_center.longitude, this.job.domain_center.latitude]);

    /* add a map click listener */
    this.map.on('click', this.mapClicked.bind(this));
  }


  /**
   * Toggle the political boundaries layer on/off
   */
  public togglePoliticalBoundaries(): void
  {
    this.politicalBoundariesLayer?.setVisible(this.politicalBoundariesVisible);
  }


  /**
   * Compute the default zoom level based on the job's domain size
   * @private
   */
  private computeZoomLevel(): number
  {
    /* get the map's view port size in pixels */
    const screenSize: Size|undefined = this.map!.getSize();
    const x: number = screenSize![0];
    const y: number = screenSize![1];

    /* fit zoom */
    let res: number = 0;
    const domainDistEW: number = this.job!.domain_size[0];
    const domainDistNS: number = this.job!.domain_size[1];
    for (let zoom = 1; zoom <= 20; zoom += 0.1)
    {
      /* get the map resolution in meters/pixel */
      res = this.map!.getView().getResolutionForZoom(zoom);

      /* compute the distances of the map view port at this zoom level */
      const mapDistEW: number = Math.round(res * x);
      const mapDistNS: number = Math.round(res * y);

      /* check if the domain overflows the view port at this zoom level */
      if (mapDistEW <= domainDistEW || mapDistNS <= domainDistNS)
        return zoom - 0.4;  /* back off half of a skosh */
    }

    /* something bad happened, return a reasonable default */
    return 5.5;
  }


  /**
   *
   * @param jobId
   * @param validTime
   * @param variable
   * @param z_level
   * @private
   */
  private loadLayer(jobId: string, validTime: number, variable: string, z_level: number): void
  {
    /* override z_level for a 2D variable */
    const lg: WrfLayerGroup|undefined = this.findLayerGroup(variable);
    if (lg !== undefined && lg.layers[0] !== undefined)
      z_level = 0;

    /* create the request data */
    const requestData: GetWrfGeoJsonRequest = {
      job_id: jobId,
      valid_time: validTime,
      variable: variable,
      z_level: z_level
    };

    this.app.api.sendGetWrfGeoJsonRequest(requestData, this.handleGetWrfGeoJsonResponse.bind(this));
  }


  /**
   *
   * @param response
   * @private
   */
  private handleGetWrfGeoJsonResponse(response: GetWrfGeoJsonResponse): void
  {
    /* handle an error case */
    if (!response.ok)
    {
      this.app.showErrorDialog(response.errors);
      return;
    }

    /* find the layer */
    let layerIndex = 0;
    while (layerIndex < this.layers.length)
    {
      if (response.data.variable === this.layers[layerIndex].variable_name)
        if (response.data.valid_time === this.layers[layerIndex].dt)
          if (response.data.z_level === this.layers[layerIndex].z_level)
            break;
      layerIndex++;
    }
    const layer: WrfLayer|undefined = (layerIndex < this.layers.length) ? this.layers[layerIndex] : undefined;

    /* cannot continue without a layer */
    if (layer === undefined)
      return;

    /* decode the base64 data */
    const geojsonObject = JSON.parse(atob(response.data.geojson));
    layer.layer_data = geojsonObject;

    const vectorSource = new VectorSource();
    const vectorLayer = new VectorLayer({source: vectorSource});

    /* create a new layer for the map */
    let features: Feature[];
    let style;
    if (layer.plot_type === 'contour')
    {
      features = new GeoJSON().readFeatures(geojsonObject);
      style = WrfViewerComponent.selfContourStyle;
    }
    else if (layer.plot_type === 'vector')
    {
      layer.data_spacing = Number(geojsonObject['dx'])
      const initialDisplaySpacing: number = this.getVectorSpacing(this.map?.getView().getResolution(), layer.data_spacing);
      layer.handleZoomChange = this.doZoomChange;
      features = this.readFeaturesVector(geojsonObject, initialDisplaySpacing);
      style = this.selfVectorStyle.bind(this);
      this.map!.on('moveend', layer.handleZoomChange.bind(this, layer, vectorLayer));

      /* cache the feature set for this spacing value */
      if (layer.features === undefined)
        layer.features = {};
      layer.features[initialDisplaySpacing] = features;

      /* eagerly create feature sets with varied spacing */
      for (let i of [1, 2, 3, 5, 9, 13])
        if (i !== initialDisplaySpacing)
          layer.features[i] = this.readFeaturesVector(geojsonObject, i);
    }
    else
      return;

    vectorSource.addFeatures(features);
    vectorLayer.setStyle(style);

    /* cache the layer in the frames map */
    const frameKey = WrfViewerComponent.generateFrameKey(response.data);
    this.frames[frameKey] = vectorLayer;

    /* add the invisible layer to the map */
    vectorLayer.setVisible(false);
    this.map!.addLayer(vectorLayer);

    /* advance the loading progress */
    const layerGroup: WrfLayerGroup|undefined = this.findLayerGroup(response.data.variable);
    if (layerGroup === undefined) return;
    layerGroup.loaded += 1;
    layerGroup.progress = (layerGroup.loaded / layerGroup.layers[layer.z_level].length) * 100;

    /* set the opacity from the layer group */
    vectorLayer.setOpacity(layerGroup.opacity);

    /* load the first frame if finished loading */
    if (layerGroup && layerGroup.loaded === layerGroup.layers[layer.z_level].length)
      this.showSelectedTimeFromLayerGroup(layerGroup);
  }

  private getVectorSpacing(resolution: number|undefined, data_spacing: number): number
  {
    // determine how many vectors to skip based on the resolution and spacing between vectors
    // 1 displays all vectors, 2 skips 1 row and column, 3 skips 2 rows and columns, etc.
    if(resolution == undefined) {
      return 3;
    }
    const space_for_each_arrow = 40;
    return Math.floor((resolution * space_for_each_arrow) / data_spacing) + 1;
  }

  private getVectorScale(zoom: number|undefined): number
  {
    // determine the multiplier to scale the wind arrows based on the current zoom
    if(!zoom || zoom >= 4.8) {
      return 1.0;
    }
    if (zoom >= 4.3) {
      return 0.9;
    }
    if (zoom >= 4.0) {
      return 0.8;
    }
    return 0.7;
  }

  private readFeaturesVector(geojsonObject: any, new_spacing?: number): Feature[]
  {
    // read map zoom and determine how many points to skip
    // const spacing = this.getVectorSpacing(this.map?.getView().getResolution(), Number(geojsonObject['dx']));
    const spacing: number = new_spacing !== undefined ? new_spacing : this.getVectorSpacing(this.map?.getView().getResolution(), Number(geojsonObject['dx']));
    let features: Feature[] = [];
    const row_length: number = Number(geojsonObject['row_length']);
    geojsonObject['vectors'].forEach(function(vector: VectorData, i: number){
      // skip rows and columns of points based on spacing
      if(i % spacing != 0 || Math.floor(i/row_length) % spacing != 0) {
        return;
      }
      // uses EPSG:4326 projection to match projection set by useGeographic()
      const feature = new Feature(
          new Point(fromLonLat([parseFloat(vector['lon']), parseFloat(vector['lat'])], 'EPSG:4326'))
      );
      feature.setProperties(vector);
      features.push(feature);
    });
    return features;

  }

  /**
   *
   * @param layerGroup
   * @private
   */
  private showSelectedTimeFromLayerGroup(layerGroup: WrfLayerGroup): void
  {
    /* find the right zLevel */
    let zLevel: number = this.req.height;
    if (layerGroup.layers[0] !== undefined)
      zLevel = 0;

    const key = WrfViewerComponent.generateFrameKey({
      'job_id': this.job!.job_id,
      'valid_time': this.selectedFrameMs / 1000,
      'variable': layerGroup.variable_name,
      'z_level': zLevel
    });
    this.frames[key].setVisible(true);
  }


  /**
   * Send a request to get selected job details
   * @private
   */
  private sendGetJobRequest(): void
  {
    /* get the job ID from the URI */
    const jobId: string = this.app.router.url.split('/')[2];

    /* send an API request to get the job details */
    const req: ListJobRequest = {job_id: jobId};
    this.app.api.sendListJobsRequest(req, this.handleGetJobResponse.bind(this));
  }


  /**
   * Receive the job details
   *
   * @param response
   * @private
   */
  private handleGetJobResponse(response: ListJobResponse): void
  {
    /* check for status and errors */
    if (!response.ok)
    {
      this.app.showErrorDialog(response.errors);
      return;
    }

    /* extract the WRF job data from the response */
    this.job = response.data.jobs[0];

    /* extract the layers from the job data */
    this.layers = this.job.layers;
    this.layerGroups = [];
    for (let layer of this.job.layers)
    {
      /* if the z_level of the layer is 'null', this means it is a 2D variable and should be set to 0 */
      if (layer.z_level === null) layer.z_level = 0;

      /* find the layer group for this layer */
      let layerGroup: WrfLayerGroup|undefined = this.findLayerGroup(layer.variable_name);

      /* create and add the layer group if it is not found */
      if (layerGroup === undefined)
      {
        layerGroup = {
          layers: {},
          loaded: 0,
          progress: 0,
          palette: layer.palette,
          units: layer.units,
          opacity: layer.opacity,
          variable_name: layer.variable_name,
          visible: layer.visible,
          display_name: layer.display_name,
          opacityChange: this.doChangeOpacity.bind(this),
          visibilityChange: this.doToggleLayer.bind(this)
        };
        this.layerGroups[this.layerGroups.length] = layerGroup;
      }

      /* add this layer to the layer group */
      if (layerGroup.layers[layer.z_level] === undefined)
        layerGroup.layers[layer.z_level] = []
      layerGroup.layers[layer.z_level][layerGroup.layers[layer.z_level].length] = layer;
    }

    /* grab a list of animation times from the first layer group in the list */
    const zLevelKeys: number[] = [];
    for (let zLevel in this.layerGroups[0].layers)
      zLevelKeys[zLevelKeys.length] = Number(zLevel);
    const layers: WrfLayer[] = this.layerGroups[0].layers[zLevelKeys[0]];
    for (let layer of layers)
      this.animationFrames[this.animationFrames.length] = new Date(layer.dt * 1000);
    this.animationFrames = this.animationFrames.sort(this.dateCompare);
    this.selectedFrameMs = this.animationFrames[0].getTime();
  }


  /**
   * Function to compare two dates used by a list sorting function
   * @param a
   * @param b
   * @private
   */
  private dateCompare(a: Date, b: Date): number
  {
    if (a.getTime() < b.getTime())
      return -1;
    if (a.getTime() > b.getTime())
      return 1;
    return 0;
  }


  /**
   * Generate a string to identify a particular frame, which is an OpenLayers Layer
   * @param data
   * @private
   */
  private static generateFrameKey(data: {[key: string]: string|number}): string
  {
    return data['job_id'] + '-' + data['valid_time'] + '-' + data['variable'] + '-' + data['z_level'];
  }


  /**
   * Use the styling that is already in the feature -- don't know why OpenLayers can't do this
   * @param feature
   * @private
   */
  private static selfContourStyle(feature: any): Style
  {
    return new Style({
      fill: new Fill({color: feature.getProperties().fill})
    });
  }

  /**
   * Set the style for vectors, e.g. wind
   * @param feature
   * @private
   */
  private selfVectorStyle(feature: any): Style[]
  {
    const vectorScale = this.getVectorScale(this.map?.getView().getZoom());
    const shaft = new RegularShape({
      points: 2,
      radius: 5,
      stroke: new Stroke({
        width: 2,
        color: 'black',
      }),
      rotateWithView: true,
    });

    const head = new RegularShape({
      points: 3,
      radius: 5*vectorScale,
      fill: new Fill({
        color: 'black',
      }),
      rotateWithView: true,
    });
    const styles = [new Style({image: shaft}), new Style({image: head})];
    const wind_direction = feature.get('wind_direction');
    const wind_speed = feature.get('wind_speed');
    // rotate arrow away from wind origin
    const angle = ((parseFloat(wind_direction) - 180) * Math.PI) / 180;
    const scale = vectorScale * parseFloat(wind_speed) / 10;
    shaft.setScale([1, scale]);
    shaft.setRotation(angle);
    head.setDisplacement([
      0,
      head.getRadius() / 2 + shaft.getRadius() * scale,
    ]);
    head.setRotation(angle);
    return styles;
  }


  /**
   * Handle a click on the map event
   *
   * @param event
   * @private
   */
  private mapClicked(event: any): void
  {
  }

  /**
   * Call the real handler function from a separate thread so the display thread is not locked up
   *
   * @param layer The layer firing the event
   * @param vectorLayer The rendered OpenLayers layer related to this event
   * @param event Other information from the event
   * @private
   */
  private doZoomChange(layer: WrfLayer, vectorLayer: VectorLayer<any>, event: any): void
  {
    setTimeout(this.doZoomChangeNow.bind(this), 0, layer, vectorLayer, event);
  }


  /**
   * Handle zoom on the map event -- regenerates features if needed
   *
   * @param layer The layer firing the event
   * @param vectorLayer The rendered OpenLayers layer related to this event
   * @param event Other information from the event
   * @private
   */
  private doZoomChangeNow(layer: WrfLayer, vectorLayer: VectorLayer<any>, event: any): void
  {
    /* ignore if layer is not a VectorLayer type */
    if (! (vectorLayer instanceof VectorLayer))
      return;

    /* calculate the spacing value for this zoom level */
    const newSpacing = this.getVectorSpacing(this.map?.getView().getResolution(), Number(layer.data_spacing));

    /* get the features from the cache */
    let features = layer.features[newSpacing];

    /* if the features were not found in the cache, create and cache them now */
    if (features === undefined)
    {
      features = this.readFeaturesVector(layer.layer_data, newSpacing);
      layer.features[newSpacing] = features;
    }

    /* collect only on-screen wind vectors */
    let localFeatures: Feature[] = [];
    const extent = this.map!.getView().calculateExtent(this.map!.getSize());
    for (let feature of features)
      if (feature.get('lon') >= extent[0] && feature.get('lon') <= extent[2])
        if (feature.get('lat') >= extent[1] && feature.get('lat') <= extent[3])
          localFeatures.push(feature);

    /* re-create the features based on the new spacing */
    const source = vectorLayer.getSource();
    source.clear();
    source.addFeatures(localFeatures);
    source.changed();
  }

  /**
   * Handle an event from the height selector changing
   * @param event
   */
  public heightChanged(event: MatSliderChange): void
  {
    /* ignore changes with no value */
    if (event.value === null)
      return;

    /* find the visible layer group */
    let visibleLG: WrfLayerGroup|undefined = undefined;
    for (let lg of this.layerGroups)
      if (lg.visible)
        visibleLG = lg;

    /* hide the current group */
    if (visibleLG) this.setLayerVisibility(visibleLG, false);

    /* set the z-level in the request */
    this.req.height = this.getClosestValidHeight(event.value);

    /* return if there is nothing else to do */
    if (visibleLG === undefined) return;

    /* make the new level visible */
    /* determine if these layers are already loaded or not */
    const layers: WrfLayer[] = visibleLG.layers[this.req.height];
    let loaded: number = 0;
    for (let layer of layers)
      if (typeof(layer.layer_data) !== 'string')
        loaded += 1;
    visibleLG.loaded = loaded;
    visibleLG.progress = (loaded / layers.length) * 100;
    visibleLG.visible = true;
    this.doToggleLayer(visibleLG);
  }


  private getClosestValidHeight(value: number): number
  {
    /* find the closest valid height and set it */
    let closest: number = this.validHeights[0];
    let diff: number = Math.abs(closest - value);

    /* check each valid height */
    for (let height of this.validHeights)
    {
      if (diff > Math.abs(height - value))
      {
        closest = height;
        diff = Math.abs(closest - value);
      }
    }

    return closest;
  }


  /**
   * Toggle a data layer on/off
   * @param layerGroup
   */
  public doToggleLayer(layerGroup: WrfLayerGroup): void
  {
    /* show a new layer */
    if (layerGroup.visible)
    {
      /* set the color palette and value range of the variable based on the first time */
      /* step of the layer group if this is a 3D field, we need to insert the selected */
      /* height, if it is a 2D field, we just use 0 for the height */
      layerGroup.palette = layerGroup.layers.hasOwnProperty(this.req.height) ? layerGroup.layers[this.req.height][0].palette : layerGroup.layers[0][0].palette;

      /* turn off all other layers */
      for (let lg of this.layerGroups)
      {
        if (layerGroup.variable_name !== lg.variable_name && lg.visible)
        {
          lg.visible = false;
          this.setLayerVisibility(lg, false);
        }
      }

      /* get the height 2D vs 3D */
      const zLevel = layerGroup.layers[0] !== undefined ? 0 : this.req.height;

      /* make sure data are loaded for the visible layer */
      this.preloadFrames(this.job!.job_id, layerGroup.variable_name, zLevel);

      /* make a single animation from visible from the new group if everything is loaded */
      if (layerGroup.loaded === layerGroup.layers[zLevel].length)
        this.showSelectedTimeFromLayerGroup(layerGroup);
    }
    else
    {
      /* hide all the animation frames from this layer group */
      this.doPauseAnimation();
      this.setLayerVisibility(layerGroup, false);
    }
  }


  /**
   * Set the visibility of all frames of a layer group
   *
   * @param layerGroup
   * @param visibility
   * @private
   */
  private setLayerVisibility(layerGroup: WrfLayerGroup, visibility: boolean): void
  {
    /* loop through all the animation frames */
    for (let z_level in layerGroup.layers)
    {
      for (let layer of layerGroup.layers[z_level])
      {
        /* generate the key value for the frame */
        const key: string = WrfViewerComponent.generateFrameKey(
            {
              'job_id': this.job!.job_id,
              'valid_time': layer.dt,
              'variable': layerGroup.variable_name,
              'z_level': z_level
            }
        );

        /* if the layer exists, then set the visibility */
        if (this.frames[key] !== undefined)
          this.frames[key].setVisible(visibility);
      }
    }

    /* finally, set the group visibility */
    layerGroup.visible = false;
  }


  public doChangeOpacity(layer: WrfLayerGroup): void
  {
    for (let key of Object.keys(this.frames))
    {
      const frame: Layer = this.frames[key];
      frame.setOpacity(layer.opacity);
    }
  }

  /**
   * Start the process of preloading data frames
   *
   * @param jobId
   * @param variable
   * @param z_level
   */
  public preloadFrames(jobId: string, variable: string, z_level: number): void
  {
    /* load a data layer if it is not yet loaded */
    for (let validTime of this.animationFrames)
    {
      const timestamp: number = Math.trunc(validTime.getTime() / 1000);
      const frameKey = WrfViewerComponent.generateFrameKey(
          {
            'job_id': jobId,
            'valid_time': timestamp,
            'variable': variable,
            'z_level': z_level
          }
      );
      if (this.frames[frameKey] === undefined)
        this.loadLayer(jobId, timestamp, variable, z_level);
    }
  }


  /**
   * Handle animate action
   */
  public doAnimate(event: any, action: string): void
  {
    if (action === 'play')
    {
      this.doTogglePlay();
      this.doPlayAnimation();
    }
    else if (action === 'pause')
    {
      this.doTogglePlay();
      this.doPauseAnimation();
    }
    else if (action === 'back')
    {
      this.doStepAnimation(-1);
    }
    else if (action === 'forward')
    {
      this.doStepAnimation(1);
    }
  }


  /**
   * Updated the 'selectedFrame' value to be the nearest available frame
   */
  public doSelectNearestFrame(): void
  {
    /* skip if there are no animation frames loaded */
    if (this.animationFrames.length === 0)
      return;

    /* if there is no frame selected, then select one */

    /* initialize values */
    let nearest: Date = this.animationFrames[0];
    let diff: number = Number.MAX_VALUE;

    /* loop over all animation frames */
    for (let frame of this.animationFrames)
    {
      /* calculate the difference between the selected frame and this frame */
      const thisDiff = Math.abs(frame.getTime() - this.selectedFrameMs);

      /* maybe update the nearest frame */
      if (thisDiff < diff)
      {
        nearest = frame;
        diff = thisDiff;
      }
    }

    /* update the selected frame to be the nearest frame */
    this.selectedFrameMs = nearest.getTime();
  }


  public doTogglePlay(): void
  {
    this.animationControls[1] = this.animationControls[1] === 'play' ? 'pause' : 'play';
  }


  private doPlayAnimation()
  {
    this.playing = true;
    this.runAnimation();
  }


  private doPauseAnimation()
  {
    this.playing = false;
  }


  /**
   * Run the animation
   * @private
   */
  private runAnimation(): void
  {
    if (this.playing)
    {
      this.doStepAnimation();
      setTimeout(this.runAnimation.bind(this), this.animationDelayMs);
    }
  }


  /**
   * Advance the time selected by the given number of steps
   *
   * @param stepSize Number of steps by which to advance the current frame
   * @private
   */
  private doStepAnimation(stepSize: number = 1)
  {
    let variableName: string = '';
    let z_level: number = 0;
    for (let lg of this.layerGroups)
      if (lg.visible)
      {
        variableName = lg.variable_name;
        z_level = lg.layers[0] !== undefined ? z_level : this.req.height;
        break;
      }

    /* hide the layer that corresponds to the current time */
    let frameKey = WrfViewerComponent.generateFrameKey(
        {
          'job_id': this.job!.job_id,
          'valid_time': Math.trunc(this.selectedFrameMs / 1000),
          'variable': variableName,
          'z_level': z_level
        }
    );
    if (this.frames[frameKey] !== undefined)
      this.frames[frameKey].setVisible(false);

    /* find the currently selected frame's index */
    let selectedIndex: number = 0;
    for (let i = 0; i < this.animationFrames.length; i++)
      if (this.selectedFrameMs === this.animationFrames[i].getTime())
      {
        selectedIndex = i;
        break;
      }

    /* calculate the new index */
    selectedIndex += stepSize;

    /* adjust the frame index to be within array index bounds -- loop the animation if we go passed the end (or beginning) */
    while (selectedIndex < 0)
      selectedIndex += this.animationFrames.length;
    while (selectedIndex >= this.animationFrames.length)
      selectedIndex -= this.animationFrames.length;

    /* update the selected frame */
    this.selectedFrameMs = this.animationFrames[selectedIndex].getTime();

    /* show the layer that corresponds to the new time */
    frameKey = WrfViewerComponent.generateFrameKey(
        {
          'job_id': this.job!.job_id,
          'valid_time': Math.trunc(this.selectedFrameMs / 1000),
          'variable': variableName,
          'z_level': z_level
        }
    );
    if (this.frames[frameKey] !== undefined)
      this.frames[frameKey].setVisible(true);
  }


  /**
   * Find a layer group for a given variable name and vertical level
   *
   * @param variableName
   * @private
   */
  private findLayerGroup(variableName: string): WrfLayerGroup|undefined
  {
    for (let layerGroup of this.layerGroups)
      if (layerGroup.variable_name === variableName)
        return layerGroup;

    return undefined;
  }


  /**
   * Create a label for the height selector
   * @param value
   */
  public pressureLabel(value: number): string
  {
    const closest = this.getClosestValidHeight(value);
    return closest + '';
  }
}
