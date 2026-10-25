package com.blufftable.api;

import com.blufftable.api.ApiModels.PlayerRequest;
import com.blufftable.api.ApiModels.PlayerView;
import com.blufftable.api.ApiModels.DebugIdentityView;
import com.blufftable.api.ApiModels.RenamePlayerRequest;
import com.blufftable.domain.Player;
import com.blufftable.service.DeviceIdentityService;
import com.blufftable.service.PlayerService;
import com.blufftable.service.RootAccessPolicy;
import com.blufftable.websocket.GameSocketHandler;
import jakarta.validation.Valid;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/players")
@CrossOrigin(originPatterns = {"http://127.0.0.1:*", "http://localhost:*", "https://*.ts.net"})
public class PlayerController {
    private final PlayerService service;
    private final DeviceIdentityService identities;
    private final RootAccessPolicy rootAccess;
    private final GameSocketHandler sockets;

    public PlayerController(PlayerService service, DeviceIdentityService identities, RootAccessPolicy rootAccess,
                            GameSocketHandler sockets) {
        this.service = service;
        this.identities = identities;
        this.rootAccess = rootAccess;
        this.sockets = sockets;
    }

    @PostMapping
    public PlayerView upsert(@Valid @RequestBody PlayerRequest request,
                             @RequestHeader(value = "Origin", required = false) String origin,
                             @RequestHeader(value = "X-Bluff-Root-Claim", required = false) String rootClaim,
                             @RequestHeader(value = "X-Bluff-Proxied", required = false) String proxied,
                             HttpServletRequest httpRequest) {
        return service.upsert(request, rootAccess.isServerRunner(httpRequest.getRemoteAddr(), origin, rootClaim, proxied));
    }

    @PatchMapping("/me")
    public PlayerView rename(@RequestHeader(value = "Authorization", required = false) String authorization,
                             @Valid @RequestBody RenamePlayerRequest request) {
        Player player = identities.authenticateAuthorization(authorization);
        PlayerView view = service.rename(player, request);
        sockets.broadcastPlayerRooms(player.getId());
        return view;
    }

    @PostMapping("/me/debug-identity")
    public DebugIdentityView debugIdentity(@RequestHeader(value = "Authorization", required = false) String authorization) {
        return service.debugIdentity(identities.authenticateAuthorization(authorization));
    }

    @GetMapping("/me")
    public PlayerView current(@RequestHeader(value = "Authorization", required = false) String authorization) {
        Player player = identities.authenticateAuthorization(authorization);
        return new PlayerView(player.getId(), player.getDisplayName(), player.identityTag(), player.isRootAccount());
    }
}
