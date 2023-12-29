import {
  Controller,
  Get,
  Route,
  Tags,
  Security,
  NoSecurity,
  Request,
  Path,
} from 'tsoa';
import packageJson from '../../package.json';
import { UserIdentitySchema, UserIdentityTable } from '../db/user-identity';
import { JwtService } from '../services/JwtService';
import { EnrichedRequest } from '../auth';
import { HttpError } from './internal/errors';
import { Keys } from '../db/base';
import { HealthResponse, JwksResponse } from './responses/responses';

@Route('')
@Tags('Api')
export class Api extends Controller {
  userIdentityTable: UserIdentityTable;

  jwtService: JwtService;

  constructor() {
    super();
    this.userIdentityTable = new UserIdentityTable();
    this.jwtService = new JwtService();
  }

  @Get('/certs')
  @NoSecurity()
  public async certs(): Promise<JwksResponse> {
    return {
      keys: await this.jwtService.getPublicKeys(),
    };
  }

  @Get('/health')
  @NoSecurity()
  public async health(): Promise<HealthResponse> {
    return {
      name: packageJson.name,
      version: packageJson.version,
      now: new Date(),
    };
  }

  @Get('/users/me')
  @Security('jwt')
  public async getIdentity(
    @Request() httpRequest: EnrichedRequest,
  ): Promise<UserIdentitySchema> {
    const item = await this.userIdentityTable
      .get(httpRequest.user!.hashKey, httpRequest.user!.rangeKey)
      .exec();

    if (!item || !item.Item) {
      throw new HttpError(404, 'Not Found');
    }

    return item.Item;
  }

  @Get('/users/{uuid}')
  @Security('jwt')
  public async getUser(@Path() uuid: string): Promise<UserIdentitySchema> {
    const result = await this.userIdentityTable
      .query()
      .keyCondition((cn) => cn.eq('uuid', uuid))
      .filter((cn) =>
        cn
          .beginsWith('hashKey', this.userIdentityTable.hashKey(''))
          .beginsWith('rangeKey', this.userIdentityTable.rangeKey('')),
      )
      .exec({ IndexName: 'uuid-index' });

    // Using the uuid-index we can use query() instead of scan() to exact match
    // We add a filter on hashKey and rangeKey to make sure it's actually a User Identity

    if (!result.Count || !result.Items || result.Items.length !== 1) {
      throw new HttpError(404, 'Not Found');
    }

    return result.Items[0];
  }

  @Get('/users')
  @Security('jwt')
  public async getUsers(): Promise<UserIdentitySchema[]> {
    const listAllUsers = async (
      startKey?: Keys,
    ): Promise<UserIdentitySchema[]> => {
      const result = await this.userIdentityTable
        .query()
        .keyCondition((cn) =>
          cn
            .eq('rangeKey', this.userIdentityTable.rangeKey(''))
            .beginsWith('hashKey', this.userIdentityTable.hashKey('')),
        )
        .startKey(startKey)
        .exec({ IndexName: 'rangeKey-hashKey-index' });

      // Using the rangeKey-hashKey-index, we can use query() instead of scan()
      // To find all records that begin with 'identity' and 'user' in the table

      if (result.LastEvaluatedKey) {
        return [
          ...(result.Items || []),
          ...(await listAllUsers(result.LastEvaluatedKey)),
        ];
      }

      return result.Items || [];
    };

    return listAllUsers();
  }
}