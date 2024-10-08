import { HttpClient, HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ODataConfiguration } from './angularODataConfiguration';

export abstract class ODataOperation<T> {
    private _expand: string[] = [];
    private _select: string[] = [];

    constructor(protected typeName: string, protected config: ODataConfiguration, protected http: HttpClient) {
    }
    
    public Expand(expand: string | string[]) {
        if (expand) {
            this._expand = this.toStringArray(expand);
        }
        return this;
    }
    /**
     * Selects Entities. If String is separated by "/" the first part will be expanded and the second part will be selected in the expand.
     * @param select 
     * @returns ODataOperation<T>
     */ 
    public Select(select: string | string[]) {
        if (select) {
            this._select = this.toStringArray(select);
        }
        return this;
    }
    
    protected getParams(aParams? : HttpParams): HttpParams {
        const expandData = new Map<string, Array<string>>();
        const normalSelects: Array<string> = [];
        

        this._expand.forEach((name) => expandData.set(name, []));

        this._select.forEach((select: string) => {
            const items: string[] = select.split('/');

            // Select contains string like: `Boss/Name`
            if (items.length > 1) {
                const expandName = items[0];
                const propertyName = items[1];

                if (!expandData.has(expandName)) {
                    expandData.set(expandName, []);
                }
                
                expandData.get(expandName)!.push(propertyName);
            }
            else {
                // Select is just a simple string like: `Boss`
                normalSelects.push(select);
            }
        });

        let params = (aParams && Object.keys(aParams).length>0)?aParams:new HttpParams();

        const expands: Array<string> = [];
        expandData.forEach((val,key)=>{
            if (val.length) {
                expands.push(`${key}(${this.config.keys.select}=${this.toCommaString(val)})`);
                return;
            }
            expands.push(key);
        });

        if (expands.length) {
            params = params.append(this.config.keys.expand, this.toCommaString(expands));
        }

        if (normalSelects.length) {
            params = params.append(this.config.keys.select, this.toCommaString(normalSelects));
        }

        return params;
    }

    protected handleResponse(entity: Observable<HttpResponse<T>>): Observable<T> {
        return entity
            .pipe(
                map(this.extractData),
                catchError((err: any, caught: Observable<T>) => {
                    if (this.config.handleError) {
                        this.config.handleError(err, caught);
                    }
                    return throwError(err);
                })
            );
    }

    protected getDefaultRequestOptions(): {
        headers?: HttpHeaders;
        observe: 'response';
        params?: HttpParams;
        reportProgress?: boolean;
        responseType?: 'json';
        withCredentials?: boolean;
    } {
        const options = Object.assign({}, this.config.defaultRequestOptions);
        options.params = this.getParams(options.params);

        return options;
    }

    protected getPostRequestOptions(): {
        headers?: HttpHeaders;
        observe: 'response';
        params?: HttpParams;
        reportProgress?: boolean;
        responseType?: 'json';
        withCredentials?: boolean;
    } {
        const options = Object.assign({}, this.config.postRequestOptions);
        options.params = this.getParams(options.params);

        return options;
    }

    protected abstract Exec(): Observable<any>;

    protected abstract GetUrl(): string;

    protected GeneratePostUrl(entitiesUri: string): string {
        const params: HttpParams = this.getParams(this.config.postRequestOptions.params);
        if (params.keys().length > 0) {
            return `${entitiesUri}?${params}`;
        }

        return entitiesUri;
    }
    protected GenerateUrl(entitiesUri: string): string {
        const params: HttpParams = this.getParams( this.config.defaultRequestOptions.params);
        if (params.keys().length > 0) {
            return `${entitiesUri}?${params}`;
        }

        return entitiesUri;
    }

    protected toStringArray(input: string | string[]): string[] {
        if (!input) {
            return [];
        }

        if (input instanceof String || typeof input === 'string') {
            return input.split(',').map(s => s.trim());
        }

        if (input instanceof Array) {
            return input;
        }

        return [];
    }

    protected toCommaString(input: string | string[]): string {
        if (input instanceof String || typeof input === 'string') {
            return input as string;
        }

        if (input instanceof Array) {
            return input.join();
        }
        
        return "";
    }

    private extractData(res: HttpResponse<T>): T {
        if (res.status < 200 || res.status >= 300) {
            throw new Error('Bad response status: ' + res.status);
        }

        const body: any = res.body;
        return body || {};
    }
}

export abstract class OperationWithKey<T> extends ODataOperation<T> {
    constructor(protected _typeName: string,
        protected override config: ODataConfiguration,
        protected override http: HttpClient,
        protected entityKey: any) {
        super(_typeName, config, http);
    }

    protected getEntityUri(): string {
        return this.config.getEntityUri(this.entityKey, this.typeName);
    }

    public GetUrl(): string {
        return this.GenerateUrl(this.getEntityUri());
    }
}

export abstract class OperationWithEntity<T> extends ODataOperation<T> {
    constructor(protected _typeName: string,
        protected override config: ODataConfiguration,
        protected override http: HttpClient,
        protected entity: T) {
        super(_typeName, config, http);
    }

    protected getEntitiesUri(): string {
        return this.config.getEntitiesUri(this._typeName);
    }

    public GetUrl(): string {
        return this.GenerateUrl(this.getEntitiesUri());
    }
}

export abstract class OperationWithKeyAndEntity<T> extends OperationWithKey<T> {
    constructor(protected override _typeName: string,
        protected override config: ODataConfiguration,
        protected override http: HttpClient,
        protected override entityKey: string,
        protected entity: T) {
        super(_typeName, config, http, entityKey);
    }

    protected override getEntityUri(): string {
        return this.config.getEntityUri(this.entityKey, this._typeName);
    }
}

export class GetOperation<T> extends OperationWithKey<T> {
    public Exec(): Observable<T> {
        return super.handleResponse(this.http.get<T>(this.getEntityUri(), this.getDefaultRequestOptions()));
    }
}

export class PostOperation<T> extends OperationWithEntity<T> {
    public Exec(): Observable<T> {
        const body = this.entity ? JSON.stringify(this.entity) : null;

        return super.handleResponse(this.http.post<T>(this.getEntitiesUri(), body, this.getPostRequestOptions()));
    }
    public override GetUrl(): string {
        return this.GeneratePostUrl(this.getEntitiesUri());
    }
}

export class PatchOperation<T> extends OperationWithKeyAndEntity<T> {
    public Exec(): Observable<T> {
        const body = this.entity ? JSON.stringify(this.entity) : null;

        return super.handleResponse(this.http.patch<T>(this.getEntityUri(), body, this.getPostRequestOptions()));
    }
    public override GetUrl(): string {
        return this.GeneratePostUrl(this.getEntityUri());
    }
}

export class PutOperation<T> extends OperationWithKeyAndEntity<T> {
    public Exec(): Observable<T> {
        const body = this.entity ? JSON.stringify(this.entity) : null;

        return super.handleResponse(this.http.put<T>(this.getEntityUri(), body, this.getPostRequestOptions()));
    }
    public override GetUrl(): string {
        return this.GeneratePostUrl(this.getEntityUri());
    }
}

export class DeleteOperation<T> extends OperationWithKey<T>{
    public Exec(): Observable<T> {
        return super.handleResponse(this.http.delete<T>(this.getEntityUri(), this.config.defaultRequestOptions));
    }
}
